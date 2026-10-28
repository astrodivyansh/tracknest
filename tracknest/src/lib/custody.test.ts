import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assets, assetEvents, checkouts, organizations, persons, users } from "@/db/schema";
import { checkIn, checkOut, CustodyError, extendDue, nextTag, type Actor } from "./custody";

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
