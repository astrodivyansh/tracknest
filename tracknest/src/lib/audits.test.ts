import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assetEvents, assets, auditItems, categories, locations, organizations, persons, sites, users } from "@/db/schema";
import { closeAudit, parseTags, recordScan, startAudit } from "./audits";
import { changeStatus, checkOut, nextTag, type Actor } from "./custody";

let actor: Actor;
let store: string;
let office: string;
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);
const asset = (name: string, locationId: string | null) =>
  run(async (tx) => {
    const siteId = locationId ? (await tx.select().from(locations).where(eq(locations.id, locationId)))[0].siteId : null;
    return (await tx.insert(assets).values({ orgId: actor.orgId, tag: await nextTag(tx, actor.orgId), name, locationId, siteId }).returning())[0];
  });
const get = async (id: string) => (await run((tx) => tx.select().from(assets).where(eq(assets.id, id))))[0];

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Audit ${Date.now()}` }).returning();
  const [u] = await db
    .insert(users)
    .values({ orgId: org.id, name: "Auditor", email: `aud-${Date.now()}@test.local`, passwordHash: "x", role: "owner" })
    .returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
  await run(async (tx) => {
    const [s] = await tx.insert(sites).values({ orgId: org.id, name: "HQ" }).returning();
    store = (await tx.insert(locations).values({ orgId: org.id, siteId: s.id, name: "Store" }).returning())[0].id;
    office = (await tx.insert(locations).values({ orgId: org.id, siteId: s.id, name: "Office" }).returning())[0].id;
  });
});

describe("audits", () => {
  it("snapshots, scans and applies results on close", async () => {
    const onShelf = await asset("Laptop", store);
    const wandered = await asset("Monitor", store); // will turn up in the office
    const gone = await asset("Camera", store);
    const wasLost = await asset("Tablet", store);
    const lent = await asset("Projector", store);
    const elsewhere = await asset("Chair", office); // not in this audit's scope
    await run((tx) => changeStatus(tx, actor, { assetId: wasLost.id, to: "lost" }));
    const [p] = await run((tx) => tx.insert(persons).values({ orgId: actor.orgId, name: "Dev" }).returning());
    await run((tx) => checkOut(tx, actor, { assetId: lent.id, holderType: "person", holderId: p.id }));

    const audit = await run((tx) => startAudit(tx, actor, { name: "Store count", locationId: store }));
    const expected = await run((tx) => tx.select().from(auditItems).where(eq(auditItems.auditId, audit.id)));
    expect(expected.map((e) => e.assetId).sort()).toEqual([onShelf.id, wandered.id, gone.id, wasLost.id].sort()); // checked-out one excluded

    const scan = (raw: string, locationId = store) => run((tx) => recordScan(tx, actor, { auditId: audit.id, raw, locationId }));
    expect((await scan(onShelf.tag)).outcome).toBe("found");
    expect((await scan(`https://x.test/a/${onShelf.tag}`)).outcome).toBe("already"); // label URL works too
    expect((await scan(wandered.tag, office)).outcome).toBe("misplaced");
    expect((await scan(wasLost.tag)).outcome).toBe("found");
    expect((await scan(elsewhere.tag)).outcome).toBe("unexpected");
    await expect(scan("NOPE-1")).rejects.toThrow(/No asset with tag NOPE-1/);

    const counts = await run((tx) => closeAudit(tx, actor, { auditId: audit.id, markMissingLost: true, applyFound: true }));
    expect(counts).toEqual({ found: 4, missing: 1, moved: 2, markedLost: 1, markedFound: 1 });

    expect((await get(wandered.id)).locationId).toBe(office);
    expect((await get(elsewhere.id)).locationId).toBe(store);
    expect((await get(gone.id)).status).toBe("lost");
    expect((await get(wasLost.id)).status).toBe("available");

    const events = await run((tx) =>
      tx.select().from(assetEvents).where(eq(assetEvents.assetId, gone.id)).orderBy(asc(assetEvents.occurredAt)),
    );
    expect(events.map((e) => e.type)).toEqual(["audited", "status_changed"]);
    expect(events[0].payload).toMatchObject({ auditName: "Store count", result: "missing" });

    await expect(scan(onShelf.tag)).rejects.toThrow(/closed/);
  });

  it("closing without applying leaves assets as they were", async () => {
    const a = await asset("Desk", store);
    const audit = await run((tx) => startAudit(tx, actor, { name: "Dry run", locationId: store }));
    await run((tx) => recordScan(tx, actor, { auditId: audit.id, raw: a.tag, locationId: office }));
    await run((tx) => closeAudit(tx, actor, { auditId: audit.id }));
    expect((await get(a.id)).locationId).toBe(store);
  });
});

describe("audit scopes", () => {
  const expectedIds = (auditId: string) =>
    run(async (tx) => (await tx.select({ id: auditItems.assetId }).from(auditItems).where(eq(auditItems.auditId, auditId))).map((r) => r.id).sort());

  it("parses pasted tags", () => {
    expect(parseTags(" tn-1, TN-2\nhttps://x.test/a/TN-3 tn-1 ")).toEqual(["TN-1", "TN-2", "TN-3"]);
  });

  it("limits to a category and its sub-categories", async () => {
    const [parent, child, other] = await run(async (tx) =>
      Promise.all(["IT", "Phones", "Furniture"].map(async (name) => (await tx.insert(categories).values({ orgId: actor.orgId, name }).returning())[0])),
    );
    await run((tx) => tx.update(categories).set({ parentId: parent.id }).where(eq(categories.id, child.id)));
    const [a, b, c] = [await asset("PC", office), await asset("Phone", office), await asset("Desk", office)];
    await run(async (tx) => {
      await tx.update(assets).set({ categoryId: parent.id }).where(eq(assets.id, a.id));
      await tx.update(assets).set({ categoryId: child.id }).where(eq(assets.id, b.id));
      await tx.update(assets).set({ categoryId: other.id }).where(eq(assets.id, c.id));
    });
    const audit = await run((tx) => startAudit(tx, actor, { name: "IT count", locationId: office, categoryId: parent.id }));
    expect(await expectedIds(audit.id)).toEqual([a.id, b.id].sort());
  });

  it("expects exactly the pasted tags and names unknown ones", async () => {
    const [a, b] = [await asset("Drill", null), await asset("Saw", store)];
    const audit = await run((tx) => startAudit(tx, actor, { name: "Spot check", tags: [a.tag.toLowerCase().toUpperCase(), b.tag] }));
    expect(audit.byList).toBe(true);
    expect(await expectedIds(audit.id)).toEqual([a.id, b.id].sort());
    await expect(run((tx) => startAudit(tx, actor, { name: "Bad", tags: [a.tag, "NOPE-9"] }))).rejects.toThrow(/NOPE-9/);
  });
});
