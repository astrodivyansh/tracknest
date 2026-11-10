import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assets, organizations, persons, subscriptionPayments, subscriptions, users } from "@/db/schema";
import { runAlerts } from "./alerts";
import type { Actor } from "./custody";
import type { Mail } from "./mail";
import { IMPORTERS } from "./import-more";
import { REPORTS } from "./reports";
import { dueDates } from "./subscription-reports";
import { dueState, linkToSubscription, nextSubscriptionTag, notifyPriceRise, priceChange, recordRecharge } from "./subscriptions";

const stamp = Date.now();
const ownerEmail = `sub-owner-${stamp}@test.local`;
const managerEmail = `sub-mgr-${stamp}@test.local`;
let actor: Actor;
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);

const newSub = (values: Partial<typeof subscriptions.$inferInsert> = {}) =>
  run(async (tx) =>
    (
      await tx
        .insert(subscriptions)
        .values({ orgId: actor.orgId, tag: await nextSubscriptionTag(tx, actor.orgId), name: "Microsoft 365", amount: "12000.00", currency: "INR", periodMonths: 12, nextDueOn: "2031-03-31", createdBy: "Admin", ...values })
        .returning()
    )[0],
  );

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Subs ${stamp}`, timezone: "Asia/Kolkata" }).returning();
  const [u] = await db.insert(users).values({ orgId: org.id, name: "Mgr", email: managerEmail, passwordHash: "x", role: "manager" }).returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
});

describe("subscriptions", () => {
  it("numbers tags SUB-000001, SUB-000002…", async () => {
    const a = await newSub();
    const b = await newSub();
    expect([a.tag, b.tag]).toEqual(["SUB-000001", "SUB-000002"]);
  });

  it("a recharge is logged for good and moves the next due date on by one period", async () => {
    const s = await newSub({ periodMonths: 1, nextDueOn: "2031-01-31" });
    const p = await run((tx) => recordRecharge(tx, actor, { subscriptionId: s.id, paidOn: "2031-01-30", amount: "12500.00", reference: "INV-9" }));
    expect(p).toMatchObject({ periodFrom: "2031-01-31", periodTo: "2031-02-28", amount: "12500.00", currency: "INR" });
    const [after] = await run((tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, s.id)));
    expect(after.nextDueOn).toBe("2031-02-28");
    // Amount defaults to the billing amount.
    const p2 = await run((tx) => recordRecharge(tx, actor, { subscriptionId: s.id, paidOn: "2031-02-27" }));
    expect(p2).toMatchObject({ amount: "12000.00", periodTo: "2031-03-28" });
    // A second submit of the same form (still showing the old due date) is refused.
    await expect(run((tx) => recordRecharge(tx, actor, { subscriptionId: s.id, forDue: "2031-02-28", paidOn: "2031-02-27" }))).rejects.toThrow(/already recorded/);
    await expect(run((tx) => tx.update(subscriptionPayments).set({ amount: "1" }).where(eq(subscriptionPayments.id, p.id)))).rejects.toThrow();
    await expect(run((tx) => tx.delete(subscriptionPayments).where(eq(subscriptionPayments.id, p.id)))).rejects.toThrow();
  });

  it("refuses to recharge a cancelled one, and checks invoice files", async () => {
    const off = await newSub({ state: "cancelled" });
    await expect(run((tx) => recordRecharge(tx, actor, { subscriptionId: off.id, paidOn: "2031-01-01" }))).rejects.toThrow(/cancelled/);
    const s = await newSub();
    const notPdf = { filename: "x.exe", bytes: new Uint8Array([0x4d, 0x5a, 0, 0]) };
    await expect(run((tx) => recordRecharge(tx, actor, { subscriptionId: s.id, paidOn: "2031-01-01", invoice: notPdf }))).rejects.toThrow(/PDF/);
  });

  it("people take seats, up to the seat count", async () => {
    const s = await newSub({ seats: 1 });
    const [a, b] = await run((tx) =>
      tx.insert(persons).values([{ orgId: actor.orgId, name: "A" }, { orgId: actor.orgId, name: "B" }]).returning(),
    );
    const [laptop] = await run((tx) => tx.insert(assets).values({ orgId: actor.orgId, tag: `SUBT-${stamp}`, name: "Laptop" }).returning());
    expect(await run((tx) => linkToSubscription(tx, actor, { subscriptionId: s.id, tags: [laptop.tag.toUpperCase()], personIds: [a.id] }))).toBe(2);
    await expect(run((tx) => linkToSubscription(tx, actor, { subscriptionId: s.id, tags: [], personIds: [b.id] }))).rejects.toThrow(/1 seat/);
    await expect(run((tx) => linkToSubscription(tx, actor, { subscriptionId: s.id, tags: ["NOPE-1"], personIds: [] }))).rejects.toThrow(/NOPE-1/);
  });

  it("knows when it's due", () => {
    const s = { nextDueOn: "2031-03-10", remindDays: 7, state: "active" };
    expect(dueState(s, "2031-03-01")).toBe("ok");
    expect(dueState(s, "2031-03-03")).toBe("soon");
    expect(dueState(s, "2031-03-10")).toBe("today");
    expect(dueState(s, "2031-03-11")).toBe("overdue");
    expect(dueState({ ...s, state: "paused" }, "2031-03-11")).toBe("off");
  });

  it("emails the owner before, on the day and weekly when overdue, and lists it for managers", async () => {
    const [owner] = await run((tx) => tx.insert(persons).values({ orgId: actor.orgId, name: "Owner", email: ownerEmail }).returning());
    const s = await newSub({ name: "Zoom", ownerId: owner.id, nextDueOn: "2032-06-10", remindDays: 5 });
    await newSub({ name: "Paused tool", ownerId: owner.id, nextDueOn: "2032-06-10", state: "paused" });
    const at = async (day: string) => {
      const mails: Mail[] = [];
      await runAlerts({ now: new Date(`${day}T04:00:00Z`), origin: "https://app.test", orgId: actor.orgId, send: async (m) => void mails.push(m) }); // 09:30 in Kolkata
      return mails.filter((m) => m.to === ownerEmail || m.to === managerEmail);
    };
    expect((await at("2032-06-04")).filter((m) => m.to === ownerEmail)).toEqual([]); // 6 days before: outside the 5-day window
    const soon = await at("2032-06-05");
    expect(soon.find((m) => m.to === ownerEmail)?.subject).toBe("Coming up: recharge Zoom by 10 Jun 2032");
    expect(soon.find((m) => m.to === managerEmail)?.text).toContain(`${s.tag} Zoom`);
    expect((await at("2032-06-06")).filter((m) => m.to === ownerEmail)).toEqual([]); // once only
    expect((await at("2032-06-10")).find((m) => m.to === ownerEmail)?.subject).toBe("Due today: recharge Zoom");
    expect((await at("2032-06-11")).find((m) => m.to === ownerEmail)?.subject).toBe("Overdue: recharge Zoom");
    expect((await at("2032-06-12")).filter((m) => m.to === ownerEmail)).toEqual([]);
    const weekOn = await at("2032-06-18");
    expect(weekOn.find((m) => m.to === ownerEmail)?.subject).toBe("Overdue: recharge Zoom");
    expect(weekOn.some((m) => m.text.includes("Paused tool"))).toBe(false);
  });

  it("flags a price rise, can adopt it as the new billing amount, and tells managers once", async () => {
    const s = await newSub({ name: "Slack", amount: "1000.00", nextDueOn: "2031-05-01", periodMonths: 1 });
    const first = await run((tx) => recordRecharge(tx, actor, { subscriptionId: s.id, paidOn: "2031-05-01" }));
    expect(first.change).toBe(0); // same as the billing amount
    const rise = await run((tx) => recordRecharge(tx, actor, { subscriptionId: s.id, paidOn: "2031-06-01", amount: "1150.00", newBilling: true }));
    expect(rise).toMatchObject({ before: "1000.00", change: 15 });
    expect((await run((tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, s.id))))[0].amount).toBe("1150.00");
    const mails: Mail[] = [];
    const org = { id: actor.orgId, name: "Subs" };
    expect(await notifyPriceRise(org, rise, "https://app.test", async (m) => void mails.push(m))).toBe(1);
    expect(mails[0]).toMatchObject({ to: managerEmail, subject: "Price rise: Slack went up 15%" });
    expect(await notifyPriceRise(org, rise, "https://app.test", async (m) => void mails.push(m))).toBe(0); // once per payment
    expect(priceChange("200", "150")).toBe(-25);
    expect(priceChange(null, "150")).toBeNull();
  });

  it("forecasts every recharge in a period, repeating monthly ones", () => {
    expect(dueDates({ nextDueOn: "2031-01-31", periodMonths: 1 }, "2031-04-30")).toEqual(["2031-01-31", "2031-02-28", "2031-03-31", "2031-04-30"]);
    expect(dueDates({ nextDueOn: "2031-06-01", periodMonths: 12 }, "2031-04-30")).toEqual([]);
  });

  it("reports spend per vendor in each currency, and recharges with their change", async () => {
    await newSub({ name: "Figma", vendor: "Figma", amount: "45.00", currency: "USD", periodMonths: 1, nextDueOn: "2031-07-01" });
    await newSub({ name: "Figma AI", vendor: "figma", amount: "120.00", currency: "USD", periodMonths: 12, nextDueOn: "2031-07-01" });
    const report = (slug: string) => REPORTS.find((r) => r.slug === slug)!;
    const spend = await run((tx) => report("subscription-spend").run(tx, { tz: "UTC", from: "2031-01-01", to: "2031-12-31" }, 100));
    expect(spend.find((r) => r[0] === "Vendor" && r[1] === "Figma")).toEqual(["Vendor", "Figma", "USD", 2, 55, 660]);
    const paid = await run((tx) => report("subscription-payments").run(tx, { tz: "UTC", from: "2031-06-01", to: "2031-06-30" }, 100));
    expect(paid.find((r) => r[2] === "Slack")?.[6]).toBe(15);
    const renewals = await run((tx) => report("subscription-renewals").run(tx, { tz: "UTC", from: "2031-07-01", to: "2031-09-30" }, 1000));
    expect(renewals.filter((r) => r[3] === "Figma").map((r) => r[0])).toEqual(["2031-07-01", "2031-08-01", "2031-09-01"]);
  });

  it("imports subscriptions from CSV, matching owners and skipping ones on file", async () => {
    const imp = (text: string) => run((tx) => IMPORTERS.subscriptions.run(tx, actor, text));
    const csv = `name,amount,currency,every,next_recharge,owner,auto_renew\r\nAdobe CC,5000,,Yearly,31/12/2031,${ownerEmail},yes\r\nNotion,8,usd,3,2031-09-01,,\r\n`;
    expect(await imp(csv)).toMatchObject({ imported: 2, skipped: 0 });
    expect(await imp(csv)).toMatchObject({ imported: 0, skipped: 2 });
    const [adobe] = await run((tx) => tx.select().from(subscriptions).where(eq(subscriptions.name, "Adobe CC")));
    expect(adobe).toMatchObject({ currency: "INR", periodMonths: 12, nextDueOn: "2031-12-31", autoRenew: true, tag: expect.stringMatching(/^SUB-\d{6}$/) });
    expect(adobe.ownerId).not.toBeNull();
    await expect(imp("name,amount,every,next_recharge\r\nX,10,fortnightly,2031-01-01\r\n")).rejects.toThrow(/every/);
    await expect(imp("name,amount,every,next_recharge,owner\r\nY,10,monthly,2031-01-01,nobody@x.com\r\n")).rejects.toThrow(/nobody@x.com/);
  });
});
