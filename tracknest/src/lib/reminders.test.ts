import { beforeAll, describe, expect, it } from "vitest";
import { and } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assets, customFields, organizations } from "@/db/schema";
import { assetFilters } from "./assets";
import { nextTag, type Actor } from "./custody";
import { upcomingDates } from "./reminders";
import { REPORTS } from "./reports";

const TODAY = "2026-11-01";
let actor: Actor;
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Remind ${Date.now()}` }).returning();
  actor = { id: org.id, name: "t", orgId: org.id };
  await run(async (tx) => {
    const [warranty, insurance, imei] = await tx
      .insert(customFields)
      .values([
        { orgId: org.id, label: "Warranty expiry", type: "date", remindDays: 30 },
        { orgId: org.id, label: "Insurance renewal", type: "date" }, // no reminder
        { orgId: org.id, label: "IMEI", type: "text" },
      ])
      .returning();
    const add = async (name: string, custom: Record<string, string>, status: "available" | "disposed" = "available") =>
      tx.insert(assets).values({ orgId: org.id, tag: await nextTag(tx, org.id), name, custom, status });
    await add("Due soon", { [warranty.id]: "2026-11-20", [imei.id]: "356938035643809" });
    await add("Due today", { [warranty.id]: TODAY });
    await add("Too far", { [warranty.id]: "2026-12-15" });
    await add("Already past", { [warranty.id]: "2026-10-31" });
    await add("Gone", { [warranty.id]: "2026-11-05" }, "disposed");
    await add("No reminder field", { [insurance.id]: "2026-11-02" });
  });
});

describe("date reminders", () => {
  it("lists dates inside each field's window, soonest first", async () => {
    const rows = await run((tx) => upcomingDates(tx, TODAY));
    expect(rows.map((r) => [r.name, r.label, r.date])).toEqual([
      ["Due today", "Warranty expiry", "2026-11-01"],
      ["Due soon", "Warranty expiry", "2026-11-20"],
    ]);
  });
});

describe("custom fields elsewhere", () => {
  it("adds custom columns and values to the asset register", async () => {
    const register = REPORTS.find((r) => r.slug === "asset-register")!;
    const cols = (await run(register.columnsFor!)).map((c) => c.label);
    expect(cols.slice(-3)).toEqual(["Warranty expiry", "Insurance renewal", "IMEI"]);
    const row = (await run((tx) => register.run(tx, { tz: "UTC", from: TODAY, to: TODAY }, 100))).find((r) => r[1] === "Due soon")!;
    expect(row.slice(-3)).toEqual(["2026-11-20", null, "356938035643809"]);
  });

  it("finds assets by a custom field value, but not by field ids", async () => {
    const search = (q: string) => run((tx) => tx.select({ name: assets.name }).from(assets).where(and(...assetFilters({ q }).where)));
    expect(await search("8035643")).toEqual([{ name: "Due soon" }]);
    const [{ id }] = await run((tx) => tx.select({ id: customFields.id }).from(customFields).limit(1));
    expect(await search(id.slice(0, 8))).toEqual([]);
  });
});
