import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, organizations } from "@/db/schema";

// Plan Selection from AssetTiger's wizard is left out: TrackNest has no pricing tiers.
export const STEPS = ["Company", "Sites", "Locations", "Categories", "Database", "Table Options", "Event Options", "Setup Inventory"] as const;
export const LAST_STEP = STEPS.length;

export const DEFAULT_CATEGORIES = ["Building improvements", "Buildings", "Computer equipment", "Equipment", "Furniture and fixtures", "Intangible assets", "Leasehold improvements", "Software", "Vehicles"];

/** The Yes/No switches each switch-only step owns; saving a step leaves every other switch alone. */
export const STEP_SWITCHES: Record<number, string[]> = {
  6: ["records", "warranty", "reserve", "move", "link"],
  7: ["checkout", "lease", "lost", "broken", "maintenance", "scrap", "donate", "sell"],
  8: ["inventory"],
};

export const applySwitches = (disabled: string[], keys: string[], off: (key: string) => boolean) => [...disabled.filter((d) => !keys.includes(d)), ...keys.filter(off)];

/** Records a finished step. Leaving step 1 for the first time adds the starter categories. */
export async function completeStep(tx: Tx, orgId: string, step: number) {
  const [org] = await tx.select({ setupStep: organizations.setupStep }).from(organizations).where(eq(organizations.id, orgId)).for("update");
  if (step === 1 && org.setupStep === 1) await tx.insert(categories).values(DEFAULT_CATEGORIES.map((name) => ({ orgId, name })));
  await tx
    .update(organizations)
    .set({ setupStep: sql`greatest(${organizations.setupStep}, ${step + 1})` })
    .where(eq(organizations.id, orgId));
}
