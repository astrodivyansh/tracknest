import { describe, expect, it } from "vitest";
import { depreciate, type DepRule } from "./depreciation";

const asset = { cost: "100000.00", purchaseDate: "2024-04-01" };
const at = (d: string) => new Date(`${d}T00:00:00Z`);
const sl: DepRule = { depMethod: "straight_line", depLifeYears: "3", depRatePct: null, depSalvagePct: "5" };
const wdv: DepRule = { depMethod: "declining", depLifeYears: null, depRatePct: "40", depSalvagePct: null };

describe("depreciate", () => {
  it("straight-line spreads cost minus salvage over the life, then stops at salvage", () => {
    expect(depreciate(asset, sl, at("2024-04-01"))).toEqual({ accumulated: 0, bookValue: 100000 });
    // 1.5 years of 95,000 / 3 = 47,500 (365.25-day years, so within a few rupees)
    expect(depreciate(asset, sl, at("2025-10-01"))!.bookValue).toBeCloseTo(52500, -2);
    expect(depreciate(asset, sl, at("2030-01-01"))).toEqual({ accumulated: 95000, bookValue: 5000 });
  });

  it("declining balance compounds the yearly rate", () => {
    expect(depreciate(asset, wdv, new Date(Date.parse("2024-04-01T00:00:00Z") + 365.25 * 864e5))).toEqual({
      accumulated: 40000,
      bookValue: 60000,
    });
    expect(depreciate(asset, { ...wdv, depSalvagePct: "10" }, at("2034-01-01"))!.bookValue).toBe(10000);
  });

  it("doesn't depreciate without a rule, cost or purchase date, or before purchase", () => {
    expect(depreciate(asset, null, at("2026-01-01"))).toBeNull();
    expect(depreciate(asset, { ...sl, depMethod: "none" }, at("2026-01-01"))).toBeNull();
    expect(depreciate({ ...asset, purchaseDate: null }, sl, at("2026-01-01"))).toBeNull();
    expect(depreciate({ ...asset, cost: null }, sl, at("2026-01-01"))).toBeNull();
    expect(depreciate(asset, sl, at("2020-01-01"))).toEqual({ accumulated: 0, bookValue: 100000 });
  });
});
