import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { alertLog, assetEvents, assets, customers, emailTemplates, organizations, persons, users } from "@/db/schema";
import { checkIn, checkOut, CustodyError, nextTag, type Actor } from "./custody";
import { render, sendEventEmails } from "./event-mail";
import { describeEvent } from "./format";
import type { Mail } from "./mail";
import { addWarranty, removeWarranty } from "./warranties";

let actor: Actor;
let customerId: string;
let personId: string;
const stamp = Date.now();
const personEmail = `meera-${stamp}@test.local`;

const newAsset = (v: Partial<typeof assets.$inferInsert> = {}) =>
  withOrg(actor.orgId, async (tx) => (await tx.insert(assets).values({ orgId: actor.orgId, tag: await nextTag(tx, actor.orgId), name: "Projector", ...v }).returning())[0]);

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Phase3 ${stamp}` }).returning();
  const [u] = await db.insert(users).values({ orgId: org.id, name: "Owner", email: `owner3-${stamp}@test.local`, passwordHash: "x", role: "owner" }).returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
  await withOrg(org.id, async (tx) => {
    customerId = (await tx.insert(customers).values({ orgId: org.id, name: "Acme Events", email: `acme-${stamp}@test.local` }).returning())[0].id;
    personId = (await tx.insert(persons).values({ orgId: org.id, name: "Meera", email: personEmail }).returning())[0].id;
  });
});

describe("leasing to customers", () => {
  it("is a check-out to a customer, described as a lease, and archived customers can't lease", async () => {
    const a = await newAsset();
    await withOrg(actor.orgId, (tx) => checkOut(tx, actor, { assetId: a.id, holderType: "customer", holderId: customerId }));
    await withOrg(actor.orgId, (tx) => checkIn(tx, actor, { assetId: a.id }));
    const events = await withOrg(actor.orgId, (tx) => tx.select().from(assetEvents).where(eq(assetEvents.assetId, a.id)).orderBy(assetEvents.occurredAt));
    expect(events.map((e) => describeEvent(e, "UTC").split(" after")[0])).toEqual(["Leased to Acme Events", "Lease returned from Acme Events"]);

    await withOrg(actor.orgId, (tx) => tx.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, customerId)));
    await expect(withOrg(actor.orgId, (tx) => checkOut(tx, actor, { assetId: a.id, holderType: "customer", holderId: customerId }))).rejects.toBeInstanceOf(CustodyError);
    await withOrg(actor.orgId, (tx) => tx.update(customers).set({ deletedAt: null }).where(eq(customers.id, customerId)));
  });
});

describe("warranties", () => {
  it("computes the end from the purchase date, records history, and can be removed", async () => {
    const a = await newAsset({ purchaseDate: "2026-01-31" });
    const w = await withOrg(actor.orgId, (tx) => addWarranty(tx, actor, { assetId: a.id, provider: "Epson", lengthMonths: 13 }));
    expect(w.expiresOn).toBe("2027-02-28");
    await withOrg(actor.orgId, (tx) => removeWarranty(tx, actor, { assetId: a.id, warrantyId: w.id }));
    const types = (await withOrg(actor.orgId, (tx) => tx.select().from(assetEvents).where(eq(assetEvents.assetId, a.id)))).map((e) => e.type);
    expect(types.sort()).toEqual(["warranty_added", "warranty_removed"]);

    const b = await newAsset();
    await expect(withOrg(actor.orgId, (tx) => addWarranty(tx, actor, { assetId: b.id, lengthMonths: 12 }))).rejects.toThrow(/purchase date/);
    await expect(withOrg(actor.orgId, (tx) => addWarranty(tx, actor, { assetId: b.id }))).rejects.toThrow(/end date/);
  });
});

describe("event emails", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(render("{tag} for {holder} {oops}", { tag: "TN-1", holder: "Meera" })).toBe("TN-1 for Meera {oops}");
  });

  it("emails the holder once per event, only for events after the template was turned on", async () => {
    const before = await newAsset();
    await withOrg(actor.orgId, (tx) => checkOut(tx, actor, { assetId: before.id, holderType: "person", holderId: personId }));
    await withOrg(actor.orgId, (tx) =>
      tx.insert(emailTemplates).values({ orgId: actor.orgId, event: "checked_out", enabled: true, toHolder: true, subject: "{tag} is with {holder}", body: "Due {due}. {link}" }),
    );
    const a = await newAsset();
    await withOrg(actor.orgId, (tx) => checkOut(tx, actor, { assetId: a.id, holderType: "person", holderId: personId }));

    const mails: Mail[] = [];
    const run = () => sendEventEmails({ orgId: actor.orgId, origin: "https://app.test", send: async (m) => void mails.push(m) });
    expect(await run()).toBe(1);
    expect(await run()).toBe(0); // claimed in alert_log
    expect(mails).toEqual([{ to: personEmail, subject: `${a.tag} is with Meera`, text: `Due no due date. https://app.test/assets/${a.id}` }]);
    expect((await withOrg(actor.orgId, (tx) => tx.select().from(alertLog))).length).toBe(1);
  });
});
