import { beforeAll, describe, expect, it } from "vitest";
import { db, withOrg } from "@/db";
import { assets, categories, organizations } from "@/db/schema";
import { nextTag } from "./custody";
import { fiscalRange, REPORTS } from "./reports";

let orgId: string;
const schedule = REPORTS.find((r) => r.slug === "depreciation-schedule")!;
const fy2025 = { tz: "Asia/Kolkata", from: "2025-04-01", to: "2026-03-31" };

beforeAll(async () => {
  orgId = (await db.insert(organizations).values({ name: `FY ${Date.now()}`, timezone: "Asia/Kolkata" }).returning())[0].id;
  await withOrg(orgId, async (tx) => {
    const [laptops] = await tx
      .insert(categories)
      .values({ orgId, name: "Laptops", depMethod: "straight_line", depLifeYears: "4.00", depSalvagePct: "0" })
      .returning();
    for (const [name, cost, purchaseDate] of [
      ["Old laptop", "100000.00", "2024-04-01"],
      ["New laptop", "40000.00", "2025-10-01"],
      ["Future laptop", "50000.00", "2026-06-01"],
    ]) {
      await tx.insert(assets).values({ orgId, tag: await nextTag(tx, orgId), name, cost, purchaseDate, categoryId: laptops.id });
    }
    const disposed = { status: "disposed" as const, disposalMethod: "sold" as const, categoryId: laptops.id, cost: "100000.00", purchaseDate: "2024-04-01" };
    await tx.insert(assets).values({ ...disposed, orgId, tag: await nextTag(tx, orgId), name: "Sold mid-year", disposedOn: "2025-10-01", disposalValue: "60000.00" });
    await tx.insert(assets).values({ ...disposed, orgId, tag: await nextTag(tx, orgId), name: "Sold last year", disposedOn: "2025-01-01" });
  });
});

describe("financial-year depreciation schedule", () => {
  it("splits each asset into opening, additions, depreciation for the year and closing", async () => {
    const rows = await withOrg(orgId, (tx) => schedule.run(tx, fy2025, 100));
    expect(rows.map((r) => r[1])).toEqual(["Old laptop", "New laptop", "Sold mid-year"]); // bought after or disposed before: left out

    const [old, fresh] = rows as number[][];
    expect(old[6]).toBe(0); // no additions
    expect(old[5]).toBeCloseTo(75000, -2); // one of four years gone at 1 Apr 2025
    expect(old[9]).toBeCloseTo(50000, -2);
    expect(old[7]).toBeCloseTo(25000, -2);
    expect(fresh[5]).toBe(0); // bought during the year: opening 0, cost under additions
    expect(fresh[6]).toBe(40000);
    expect(fresh[7]).toBeCloseTo(5000, -2); // half a year of 10,000
    const sold = rows[2] as number[];
    // Depreciation runs by day, so half a year is about 12,500 (183 of 365.25 days).
    expect(Math.abs(sold[7] - 12500)).toBeLessThan(200); // depreciation only until the sale
    expect(Math.abs(sold[8] - 62500)).toBeLessThan(200); // remaining book value leaves as a disposal
    expect(sold[9]).toBe(0);
    for (const r of rows as number[][]) expect(r[5] + r[6] - r[7] - r[8]).toBeCloseTo(r[9], 2);
  });

  it("reports disposals with gain or loss, and drops them from book value after the sale", async () => {
    const disposals = REPORTS.find((r) => r.slug === "disposals")!;
    const rows = await withOrg(orgId, (tx) => disposals.run(tx, fy2025, 100));
    expect(rows.map((r) => r[2])).toEqual(["Sold mid-year"]);
    expect(rows[0][4]).toBe("Sold");
    const [book, proceeds, gain] = rows[0].slice(6) as number[];
    expect(proceeds).toBe(60000);
    expect(gain).toBeCloseTo(proceeds - book, 2);
    expect(gain).toBeLessThan(0); // sold below book value: a loss

    const bookValue = REPORTS.find((r) => r.slug === "depreciation")!;
    const names = async (to: string) => (await withOrg(orgId, (tx) => bookValue.run(tx, { ...fy2025, to }, 100))).map((r) => r[1]);
    expect(await names("2025-09-30")).toContain("Sold mid-year");
    expect(await names("2025-10-01")).not.toContain("Sold mid-year");
  });

  it("picks the financial year from ?fy, defaulting to the current one", () => {
    expect(fiscalRange({ fy: "2024" }, "UTC")).toMatchObject({ fy: 2024, from: "2024-04-01", to: "2025-03-31" });
    const { fy, current } = fiscalRange({ fy: "nonsense" }, "UTC");
    expect(fy).toBe(current);
    const today = new Date();
    expect(current).toBe(today.getUTCFullYear() - (today.getUTCMonth() < 3 ? 1 : 0));
  });
});
