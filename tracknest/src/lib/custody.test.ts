import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assets, assetEvents, checkouts, departments, locations, maintenance, organizations, persons, sites, users } from "@/db/schema";
import { scheduleMaintenance } from "./maintenance";
import {
  archiveAsset,
  changeStatus,
  checkIn,
  checkOut,
  CustodyError,
  duplicateAsset,
  extendDue,
  linkAsset,
  moveAsset,
  nextTag,
  unlinkAsset,
  type Actor,
} from "./custody";

let actor: Actor;
let otherOrgId: string;
let personId: string;

async function newAsset() {
  return withOrg(actor.orgId, async (tx) => {
    const [a] = await tx
      .insert(assets)
      .values({ orgId: actor.orgId, tag: await nextTag(tx, actor.orgId), name: "Laptop" })
      .returning();
    return a;
  });
}

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Test ${Date.now()}` }).returning();
  const [other] = await db.insert(organizations).values({ name: `Other ${Date.now()}` }).returning();
  otherOrgId = other.id;
  const [u] = await db
    .insert(users)
    .values({ orgId: org.id, name: "Admin", email: `admin-${Date.now()}@test.local`, passwordHash: "x", role: "owner" })
    .returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
  const [p] = await withOrg(org.id, (tx) =>
    tx.insert(persons).values({ orgId: org.id, name: "Priya" }).returning(),
  );
  personId = p.id;
});

describe("custody history", () => {
  it("check-out then check-in writes exactly two complete history records", async () => {
    const asset = await newAsset();
    const due = new Date(Date.now() + 7 * 864e5);
    await withOrg(actor.orgId, (tx) =>
      checkOut(tx, actor, { assetId: asset.id, holderType: "person", holderId: personId, dueAt: due, condition: "Good" }),
    );
    await withOrg(actor.orgId, (tx) => checkIn(tx, actor, { assetId: asset.id, condition: "Good", notes: "ok" }));

    const { events, co, a } = await withOrg(actor.orgId, async (tx) => ({
      events: await tx.select().from(assetEvents).where(eq(assetEvents.assetId, asset.id)).orderBy(assetEvents.occurredAt),
      co: (await tx.select().from(checkouts).where(eq(checkouts.assetId, asset.id)))[0],
      a: (await tx.select().from(assets).where(eq(assets.id, asset.id)))[0],
    }));
    expect(events.map((e) => e.type)).toEqual(["checked_out", "checked_in"]);
    expect(events[0].payload).toMatchObject({ holderName: "Priya", condition: "Good", dueAt: due.toISOString() });
    expect(events.every((e) => e.checkoutId === co.id && e.actorName === "Admin")).toBe(true);
    expect(co).toMatchObject({ state: "returned", holderName: "Priya", checkedInBy: actor.id });
    expect(a).toMatchObject({ status: "available", holderId: null });
  });

  it("only one of two simultaneous check-outs succeeds", async () => {
    const asset = await newAsset();
    const attempt = () =>
      withOrg(actor.orgId, (tx) =>
        checkOut(tx, actor, { assetId: asset.id, holderType: "person", holderId: personId }),
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(CustodyError);
  });

  it("history cannot be edited or deleted by the app", async () => {
    const asset = await newAsset();
    await withOrg(actor.orgId, (tx) =>
      checkOut(tx, actor, { assetId: asset.id, holderType: "person", holderId: personId }),
    );
    await withOrg(actor.orgId, (tx) => checkIn(tx, actor, { assetId: asset.id }));

    const tamper = (q: ReturnType<typeof sql>) => withOrg(actor.orgId, (tx) => tx.execute(q));
    await expect(tamper(sql`update asset_events set type = 'edited' where asset_id = ${asset.id}`)).rejects.toThrow();
    await expect(tamper(sql`delete from asset_events where asset_id = ${asset.id}`)).rejects.toThrow();
    await expect(tamper(sql`delete from checkouts where asset_id = ${asset.id}`)).rejects.toThrow();
    await expect(
      tamper(sql`update checkouts set in_notes = 'changed' where asset_id = ${asset.id}`),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/closed and cannot be changed/) } });
  });

  it("extending the due date is logged with old and new dates", async () => {
    const asset = await newAsset();
    const d1 = new Date(Date.now() + 864e5);
    const d2 = new Date(Date.now() + 3 * 864e5);
    await withOrg(actor.orgId, (tx) =>
      checkOut(tx, actor, { assetId: asset.id, holderType: "person", holderId: personId, dueAt: d1 }),
    );
    await withOrg(actor.orgId, (tx) => extendDue(tx, actor, { assetId: asset.id, dueAt: d2 }));
    const events = await withOrg(actor.orgId, (tx) =>
      tx.select().from(assetEvents).where(eq(assetEvents.assetId, asset.id)).orderBy(assetEvents.occurredAt),
    );
    expect(events[1]).toMatchObject({ type: "due_extended", payload: { from: d1.toISOString(), to: d2.toISOString() } });
  });

  it("another organization cannot see this org's assets or history", async () => {
    await newAsset();
    const seen = await withOrg(otherOrgId, async (tx) => ({
      assets: await tx.select().from(assets),
      events: await tx.select().from(assetEvents),
    }));
    expect(seen.assets).toHaveLength(0);
    expect(seen.events).toHaveLength(0);
  });
});

describe("status changes", () => {
  it("records each move and enforces the allowed transitions", async () => {
    const asset = await newAsset();
    const move = (to: "lost" | "available" | "disposed" | "broken", reason?: string) =>
      withOrg(actor.orgId, (tx) =>
        changeStatus(tx, actor, { assetId: asset.id, to, reason, disposal: to === "disposed" ? { on: "2026-01-15", method: "sold", value: "5000.00" } : undefined }),
      );

    await move("lost", "left in cab");
    await move("available"); // found
    await expect(move("disposed")).rejects.toThrow(/reason/);
    await move("disposed", "sold");
    await expect(move("available")).rejects.toThrow(CustodyError); // disposed is final

    const events = await withOrg(actor.orgId, (tx) =>
      tx.select().from(assetEvents).where(eq(assetEvents.assetId, asset.id)).orderBy(assetEvents.occurredAt),
    );
    expect(events.map((e) => e.payload)).toEqual([
      { from: "available", to: "lost", reason: "left in cab" },
      { from: "lost", to: "available", reason: null },
      { from: "available", to: "disposed", reason: "sold", disposal: { on: "2026-01-15", method: "sold", value: "5000.00" } },
    ]);
  });

  it("needs disposal details, and no future dates", async () => {
    const asset = await newAsset();
    const dispose = (disposal?: { on: string; method: "scrapped" }) =>
      withOrg(actor.orgId, (tx) => changeStatus(tx, actor, { assetId: asset.id, to: "disposed", reason: "old", disposal }));
    await expect(dispose()).rejects.toThrow(/how and when/);
    await expect(dispose({ on: "2999-01-01", method: "scrapped" })).rejects.toThrow(/in the future/);
    await dispose({ on: "2026-01-02", method: "scrapped" });
    const [a] = await withOrg(actor.orgId, (tx) => tx.select().from(assets).where(eq(assets.id, asset.id)));
    expect(a).toMatchObject({ status: "disposed", disposedOn: "2026-01-02", disposalMethod: "scrapped", disposalValue: null });
  });

  it("refuses to change status while checked out", async () => {
    const asset = await newAsset();
    await withOrg(actor.orgId, (tx) =>
      checkOut(tx, actor, { assetId: asset.id, holderType: "person", holderId: personId }),
    );
    await expect(
      withOrg(actor.orgId, (tx) => changeStatus(tx, actor, { assetId: asset.id, to: "lost" })),
    ).rejects.toThrow(/Check it in first/);
  });
});

describe("archiving", () => {
  it("hides the asset, keeps its history and cancels scheduled maintenance", async () => {
    const asset = await newAsset();
    await withOrg(actor.orgId, (tx) => scheduleMaintenance(tx, actor, { assetId: asset.id, title: "Service", kind: "preventive" }));
    await withOrg(actor.orgId, (tx) => archiveAsset(tx, actor, { assetId: asset.id, reason: "duplicate" }));

    const { a, jobs, events } = await withOrg(actor.orgId, async (tx) => ({
      a: (await tx.select().from(assets).where(eq(assets.id, asset.id)))[0],
      jobs: await tx.select().from(maintenance).where(eq(maintenance.assetId, asset.id)),
      events: await tx.select().from(assetEvents).where(eq(assetEvents.assetId, asset.id)).orderBy(assetEvents.occurredAt),
    }));
    expect(a.deletedAt).not.toBeNull();
    expect(jobs.map((j) => j.state)).toEqual(["cancelled"]);
    expect(events.map((e) => e.type)).toEqual(["maintenance_scheduled", "archived"]);
    // Gone for custody actions too.
    await expect(withOrg(actor.orgId, (tx) => changeStatus(tx, actor, { assetId: asset.id, to: "lost" }))).rejects.toThrow(/not found/);
  });

  it("refuses while the asset is checked out", async () => {
    const asset = await newAsset();
    await withOrg(actor.orgId, (tx) => checkOut(tx, actor, { assetId: asset.id, holderType: "person", holderId: personId }));
    await expect(withOrg(actor.orgId, (tx) => archiveAsset(tx, actor, { assetId: asset.id, reason: "x" }))).rejects.toThrow(/Bring it back/);
  });
});

describe("move, link and duplicate", () => {
  const typesOf = (assetId: string) =>
    withOrg(actor.orgId, async (tx) =>
      (await tx.select().from(assetEvents).where(eq(assetEvents.assetId, assetId)).orderBy(assetEvents.occurredAt)).map((e) => e.type),
    );

  it("moves a parent and its linked child, recording both", async () => {
    const [parent, child] = [await newAsset(), await newAsset()];
    const { loc, dept } = await withOrg(actor.orgId, async (tx) => {
      const [site] = await tx.insert(sites).values({ orgId: actor.orgId, name: "HQ" }).returning();
      const [loc] = await tx.insert(locations).values({ orgId: actor.orgId, siteId: site.id, name: "Store" }).returning();
      const [dept] = await tx.insert(departments).values({ orgId: actor.orgId, name: "IT" }).returning();
      return { loc, dept };
    });
    await withOrg(actor.orgId, (tx) => linkAsset(tx, actor, { childId: child.id, parentTag: parent.tag.toLowerCase() }));
    const moved = await withOrg(actor.orgId, (tx) => moveAsset(tx, actor, { assetId: parent.id, locationId: loc.id, departmentId: dept.id }));
    expect(moved).toBe(true);

    const rows = await withOrg(actor.orgId, (tx) => tx.select().from(assets).where(sql`${assets.id} in (${parent.id}, ${child.id})`));
    expect(rows.every((r) => r.locationId === loc.id && r.siteId === loc.siteId && r.departmentId === dept.id && r.status === "available")).toBe(true);
    expect(await typesOf(child.id)).toEqual(["linked", "moved"]);
    expect(await typesOf(parent.id)).toEqual(["linked", "moved"]);
    // Nothing to change: no event.
    expect(await withOrg(actor.orgId, (tx) => moveAsset(tx, actor, { assetId: parent.id, locationId: loc.id, departmentId: null }))).toBe(false);
  });

  it("keeps links one level deep and unlinks with history", async () => {
    const [a, b, c] = [await newAsset(), await newAsset(), await newAsset()];
    const link = (childId: string, parentTag: string) => withOrg(actor.orgId, (tx) => linkAsset(tx, actor, { childId, parentTag }));
    await expect(link(a.id, a.tag)).rejects.toThrow(/itself/);
    await link(b.id, a.tag);
    await expect(link(c.id, b.tag)).rejects.toThrow(/itself linked/);
    await expect(link(a.id, c.tag)).rejects.toThrow(/its own linked assets/);
    await expect(link(c.id, "NOPE-1")).rejects.toBeInstanceOf(CustodyError);
    await withOrg(actor.orgId, (tx) => unlinkAsset(tx, actor, { childId: b.id }));
    const [row] = await withOrg(actor.orgId, (tx) => tx.select().from(assets).where(eq(assets.id, b.id)));
    expect(row.parentId).toBeNull();
    expect(await typesOf(a.id)).toEqual(["linked", "unlinked"]);
  });

  it("duplicates with new tags and no serial", async () => {
    const src = await newAsset();
    await withOrg(actor.orgId, (tx) => tx.update(assets).set({ serial: "SN1", brand: "Dell", purchasedFrom: "Croma" }).where(eq(assets.id, src.id)));
    const copies = await withOrg(actor.orgId, (tx) => duplicateAsset(tx, actor, { assetId: src.id, copies: 2 }));
    expect(new Set(copies.map((c) => c.tag)).size).toBe(2);
    const rows = await withOrg(actor.orgId, (tx) => tx.select().from(assets).where(sql`${assets.id} in (${copies[0].id}, ${copies[1].id})`));
    expect(rows.every((r) => r.serial === null && r.brand === "Dell" && r.purchasedFrom === "Croma" && r.tag !== src.tag)).toBe(true);
    const [ev] = await withOrg(actor.orgId, (tx) => tx.select().from(assetEvents).where(eq(assetEvents.assetId, copies[0].id)));
    expect(ev.payload).toMatchObject({ copiedFrom: src.tag });
  });
});
