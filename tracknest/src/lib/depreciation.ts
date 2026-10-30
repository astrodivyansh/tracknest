import type { DepMethod } from "@/db/schema";

export type DepRule = {
  depMethod: DepMethod;
  depLifeYears: string | null;
  depRatePct: string | null;
  depSalvagePct: string | null;
};

export const DEP_LABEL: Record<DepMethod, string> = {
  none: "Not depreciated",
  straight_line: "Straight-line",
  declining: "Declining balance (WDV)",
  double_declining: "Double declining balance",
  sum_of_years: "Sum of the years' digits",
};

/** Methods that need a useful life (the rest need a yearly rate, or nothing). */
export const NEEDS_LIFE: DepMethod[] = ["straight_line", "double_declining", "sum_of_years"];

const YEAR_MS = 365.25 * 864e5;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Book value of an asset on `asOf`, pro-rated by day from the purchase date.
 * - straight_line: (cost − salvage) spread evenly over the useful life.
 * - declining: cost × (1 − rate)^years, never below salvage.
 * - double_declining: declining at twice the straight-line rate (2 ÷ life), never below salvage.
 * - sum_of_years: (cost − salvage) × (life − year + 1) ÷ (1 + 2 + … + life) each year; whole years of life.
 * Returns null when the rule or the asset's cost/purchase date is missing.
 */
export function depreciate(
  asset: { cost: string | null; purchaseDate: string | null },
  rule: DepRule | null,
  asOf: Date,
): { accumulated: number; bookValue: number } | null {
  if (!rule || rule.depMethod === "none" || !asset.cost || !asset.purchaseDate) return null;
  const cost = Number(asset.cost);
  const salvage = (cost * Number(rule.depSalvagePct ?? 0)) / 100;
  const years = Math.max(0, (asOf.getTime() - Date.parse(`${asset.purchaseDate}T00:00:00Z`)) / YEAR_MS);

  let book: number;
  const life = Number(rule.depLifeYears);
  if (rule.depMethod === "straight_line") {
    if (!(life > 0)) return null;
    book = Math.max(salvage, cost - ((cost - salvage) * years) / life);
  } else if (rule.depMethod === "double_declining") {
    if (!(life >= 2)) return null;
    book = Math.max(salvage, cost * (1 - 2 / life) ** years);
  } else if (rule.depMethod === "sum_of_years") {
    if (!(Number.isInteger(life) && life > 0)) return null;
    const k = Math.min(Math.floor(years), life); // whole years done
    const part = k < life ? years - k : 0; // pro-rated share of the current year
    const digits = k * life - (k * (k - 1)) / 2 + part * (life - k);
    book = cost - ((cost - salvage) * digits) / ((life * (life + 1)) / 2);
  } else {
    const rate = Number(rule.depRatePct) / 100;
    if (!(rate > 0 && rate < 1)) return null;
    book = Math.max(salvage, cost * (1 - rate) ** years);
  }
  return { accumulated: round2(cost - book), bookValue: round2(book) };
}
