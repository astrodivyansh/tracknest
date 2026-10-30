import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { alertLog, assets, categories, checkouts, customers, organizations, persons, savedReports, users } from "@/db/schema";
import { startAudit } from "./audits";
import { changeStatus, checkOut, type Actor } from "./custody";
import type { Mail } from "./mail";
import { addWarranty } from "./warranties";
import { reserve } from "./reservations";
import { isDue, sendScheduledReports } from "./saved-reports";
import { importAssets } from "./import";
import { completeMaintenance, scheduleMaintenance } from "./maintenance";
import { REPORTS, reportRange, runReport, totals } from "./reports";

let actor: Actor;
const ctx = { tz: "Asia/Kolkata", from: "2000-01-01", to: "2100-01-01" };
const run = (slug: string) => withOrg(actor.orgId, (tx) => REPORTS.find((r) => r.slug === slug)!.run(tx, ctx, 100));

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Reports ${Date.now()}` }).returning();
  const [u] = await db
    .insert(users)
    .values({ orgId: org.id, name: "Admin", email: `rep-${Date.now()}@test.local`, passwordHash: "x", role: "owner" })
    .returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
  await withOrg(org.id, async (tx) => {
    await importAssets(tx, actor, "name,category,cost\nLaptop,Laptops,1000\nLaptop 2,Laptops,500.50\nChair,,200\n");
    const [p] = await tx.insert(persons).values({ orgId: org.id, name: "Kiran" }).returning();
    const [, laptop2] = (await tx.query.assets.findMany({ orderBy: (a, { asc }) => [asc(a.tag)] }));
    const co = await checkOut(tx, actor, { assetId: laptop2.id, holderType: "person", holderId: p.id, dueAt: new Date(Date.now() + 864e5) });
    await tx.update(checkouts).set({ dueAt: new Date(Date.now() - 3 * 864e5) }).where(eq(checkouts.id, co.id));
    const job = await scheduleMaintenance(tx, actor, { assetId: laptop2.id, title: "Battery", kind: "repair" });
    await completeMaintenance(tx, actor, { maintenanceId: job.id, cost: "750.00" });

    // One of everything the newer reports list.
    const [laptop, , chair] = await tx.query.assets.findMany({ orderBy: (a, { asc }) => [asc(a.tag)] });
    const [c] = await tx.insert(customers).values({ orgId: org.id, name: "Acme" }).returning();
    await checkOut(tx, actor, { assetId: chair.id, holderType: "customer", holderId: c.id });
    await tx.update(assets).set({ purchaseDate: "2025-01-01" }).where(eq(assets.id, laptop.id));
    await addWarranty(tx, actor, { assetId: laptop.id, lengthMonths: 24 });
    await scheduleMaintenance(tx, actor, { assetId: laptop.id, title: "Service", kind: "preventive", dueDate: "2099-01-01" });
    await reserve(tx, actor, { assetId: laptop.id, holderType: "person", holderId: p.id, startDate: "2099-02-01", endDate: "2099-02-03" });
    await changeStatus(tx, actor, { assetId: laptop.id, to: "broken", reason: "dropped" });
    await changeStatus(tx, actor, { assetId: laptop.id, to: "available", reason: "fixed" });
    await startAudit(tx, actor, { name: "Count" });
  });
});

describe("reports", () => {
  it("every report runs and returns one cell per column", async () => {
    for (const r of REPORTS) {
      const rows = await run(r.slug);
      const columns = r.columnsFor ? await withOrg(actor.orgId, r.columnsFor) : r.columns;
      if (r.slug !== "disposals") expect(rows.length, r.slug).toBeGreaterThan(0); // nothing is disposed in this org
      for (const row of rows) expect(row.length, r.slug).toBe(columns.length);
    }
  });

  it("computes the numbers", async () => {
    expect(await run("by-category")).toEqual([
      ["Laptops", 2, 1, 1, 0, "1500.50"],
      ["Uncategorised", 1, 0, 1, 0, "200.00"], // the chair is leased
    ]);
    expect((await run("overdue"))[0].slice(0, 3)).toEqual(["TN-000002", "Laptop 2", "Kiran"]);
    expect((await run("overdue"))[0][4]).toBe(3);
    const register = REPORTS.find((r) => r.slug === "asset-register")!;
    expect(totals(register.columns, await run("asset-register"))?.at(-1)).toBeCloseTo(1700.5);
    expect((await run("maintenance-cost"))[0].slice(1, 4)).toEqual(["TN-000002", "Laptop 2", "Battery"]);
  });

  it("works out book value from the category rule", async () => {
    await withOrg(actor.orgId, async (tx) => {
      await tx.update(categories).set({ depMethod: "straight_line", depLifeYears: "4.00", depSalvagePct: "0" }).where(eq(categories.name, "Laptops"));
      await tx.update(assets).set({ purchaseDate: "2024-01-01" }).where(eq(assets.name, "Laptop"));
    });
    const rows = await withOrg(actor.orgId, (tx) =>
      REPORTS.find((r) => r.slug === "depreciation")!.run(tx, { ...ctx, to: "2026-01-01" }, 100),
    );
    const laptop = rows.find((r) => r[1] === "Laptop")!;
    expect(laptop.slice(3, 6)).toEqual(["Straight-line", "2024-01-01", "1000.00"]);
    expect(laptop[7]).toBeCloseTo(500, -1); // two of four years gone
    expect(rows.find((r) => r[1] === "Chair")!.slice(3)).toEqual(["No category", null, "200.00", 0, 200]);
  });

  it("defaults the date range to this year so far", () => {
    const year = new Date().getFullYear();
    expect(reportRange({}, "UTC").from).toBe(`${year}-01-01`);
    expect(reportRange({ from: "2026-02-01", to: "bad" }, "UTC").from).toBe("2026-02-01");
  });
});

describe("report columns and schedules", () => {
  it("picks columns by index and keeps them in the parameters", async () => {
    const report = REPORTS.find((r) => r.slug === "overdue")!;
    const r = await withOrg(actor.orgId, (tx) => runReport(tx, report, { col: ["0", "4"] }, "Asia/Kolkata", 10));
    expect(r.columns.map((c) => c.label)).toEqual(["Tag", "Days overdue"]);
    expect(r.rows[0]).toEqual(["TN-000002", 3]);
    expect(r.params).toBe("col=0&col=4");
    const all = await withOrg(actor.orgId, (tx) => runReport(tx, report, {}, "Asia/Kolkata", 10));
    expect(all.columns).toHaveLength(5);
    expect(all.params).toBe("");
  });

  it("knows which days a schedule is due", () => {
    expect(isDue("daily", "2026-11-04")).toBe(true);
    expect(isDue("weekly", "2026-11-02")).toBe(true); // Monday
    expect(isDue("weekly", "2026-11-03")).toBe(false);
    expect(isDue("monthly", "2026-11-01")).toBe(true);
    expect(isDue("monthly", "2026-11-02")).toBe(false);
    expect(isDue("none", "2026-11-01")).toBe(false);
  });

  it("emails a scheduled report as CSV once a day", async () => {
    const to = `sched-${Date.now()}@test.local`;
    await withOrg(actor.orgId, (tx) =>
      tx.insert(savedReports).values({ orgId: actor.orgId, name: "Overdue daily", slug: "overdue", params: "col=0&col=2", schedule: "daily", recipients: [to], createdBy: "t" }),
    );
    const mails: Mail[] = [];
    const org = { id: actor.orgId, name: "Org", tz: "Asia/Kolkata" };
    const send = async (m: Mail) => void mails.push(m);
    expect(await sendScheduledReports(org, "2026-11-04", send, "https://app.test")).toBe(1);
    expect(await sendScheduledReports(org, "2026-11-04", send, "https://app.test")).toBe(0);
    expect(mails[0].to).toBe(to);
    expect(mails[0].attachments?.[0].content).toContain('"Tag","Held by"\r\n"TN-000002","Kiran"');
    expect((await withOrg(actor.orgId, (tx) => tx.select().from(alertLog))).length).toBe(1);
  });
});
