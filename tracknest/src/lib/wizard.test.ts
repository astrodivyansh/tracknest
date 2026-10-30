import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { categories, organizations } from "@/db/schema";
import { disposalOn, statusOn } from "./permissions";
import { applySwitches, completeStep, DEFAULT_CATEGORIES, LAST_STEP } from "./wizard";

describe("setup wizard", () => {
  it("adds the starter categories once and never moves progress backwards", async () => {
    const [org] = await db.insert(organizations).values({ name: `Wizard ${Date.now()}` }).returning();
    const state = () =>
      withOrg(org.id, async (tx) => ({
        step: (await tx.select().from(organizations).where(eq(organizations.id, org.id)))[0].setupStep,
        categories: (await tx.select().from(categories)).length,
      }));
    expect(await state()).toEqual({ step: 1, categories: 0 });
    await withOrg(org.id, (tx) => completeStep(tx, org.id, 1));
    expect(await state()).toEqual({ step: 2, categories: DEFAULT_CATEGORIES.length });
    await withOrg(org.id, (tx) => completeStep(tx, org.id, LAST_STEP));
    await withOrg(org.id, (tx) => completeStep(tx, org.id, 1)); // re-running step 1 later
    expect(await state()).toEqual({ step: LAST_STEP + 1, categories: DEFAULT_CATEGORIES.length });
  });

  it("changes only the switches a step owns", () => {
    expect(applySwitches(["lease", "records"], ["records", "warranty"], (k) => k === "warranty")).toEqual(["lease", "warranty"]);
  });

  it("maps event switches to status changes and disposal methods", () => {
    const u = { disabled: ["lost", "sell", "scrap"] };
    expect(statusOn(u, "lost")).toBe(false);
    expect(statusOn(u, "broken")).toBe(true);
    expect(statusOn(u, "available")).toBe(true);
    expect(disposalOn(u, "sold")).toBe(false);
    expect(disposalOn(u, "written_off")).toBe(false);
    expect(disposalOn(u, "donated")).toBe(true);
  });
});
