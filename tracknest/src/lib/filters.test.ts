import { beforeAll, describe, expect, it } from "vitest";
import { and, asc } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assets, categories, departments, locations, organizations, sites } from "@/db/schema";
import { assetFilters } from "./assets";
import { checkIn, checkOut, nextTag, type Actor } from "./custody";
import { checkoutsFor } from "./history";

let actor: Actor;
const ids: Record<string, string> = {};
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);
const names = (sp: Record<string, string>) =>
  run(async (tx) => (await tx.select({ name: assets.name }).from(assets).where(and(...assetFilters(sp).where)).orderBy(asc(assets.name))).map((r) => r.name));

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Filters ${Date.now()}` }).returning();
  actor = { id: org.id, name: "t", orgId: org.id };
  await run(async (tx) => {
    const [site] = await tx.insert(sites).values({ orgId: org.id, name: "HQ" }).returning();
    ids.store = (await tx.insert(locations).values({ orgId: org.id, siteId: site.id, name: "Store" }).returning())[0].id;
    ids.lab = (await tx.insert(locations).values({ orgId: org.id, siteId: site.id, name: "Lab" }).returning())[0].id;
    ids.laptops = (await tx.insert(categories).values({ orgId: org.id, name: "Laptops" }).returning())[0].id;
    ids.gaming = (await tx.insert(categories).values({ orgId: org.id, name: "Gaming", parentId: ids.laptops }).returning())[0].id;
    ids.finance = (await tx.insert(departments).values({ orgId: org.id, name: "Finance" }).returning())[0].id;
    const add = async (name: string, v: Partial<typeof assets.$inferInsert>) =>
      (await tx.insert(assets).values({ orgId: org.id, tag: await nextTag(tx, org.id), name, ...v }).returning())[0].id;
    ids.a = await add("Laptop in store", { categoryId: ids.laptops, locationId: ids.store, siteId: site.id, departmentId: ids.finance });
    await add("Laptop in lab", { categoryId: ids.laptops, locationId: ids.lab, siteId: site.id });
    await add("Gaming laptop", { categoryId: ids.gaming });
    await add("Chair in store", { locationId: ids.store, siteId: site.id, departmentId: ids.finance });
  });
});

describe("asset filters", () => {
  it("combine category, location and department, and ignore malformed ids", async () => {
    // A category includes its sub-categories; a sub-category only itself.
    expect(await names({ categoryId: ids.laptops })).toEqual(["Gaming laptop", "Laptop in lab", "Laptop in store"]);
    expect(await names({ categoryId: ids.gaming })).toEqual(["Gaming laptop"]);
    expect(await names({ locationId: ids.store })).toEqual(["Chair in store", "Laptop in store"]);
    expect(await names({ departmentId: ids.finance, categoryId: ids.laptops })).toEqual(["Laptop in store"]);
    expect(await names({ locationId: "not-a-uuid" })).toHaveLength(4);
    expect(assetFilters({ q: "x", locationId: ids.lab, status: "bogus" }).params).toEqual({ q: "x", locationId: ids.lab });
  });

  it("checkoutsFor lists a location's check-outs, open and returned", async () => {
    await run((tx) => checkOut(tx, actor, { assetId: ids.a, holderType: "location", holderId: ids.lab }));
    await run((tx) => checkIn(tx, actor, { assetId: ids.a }));
    await run((tx) => checkOut(tx, actor, { assetId: ids.a, holderType: "location", holderId: ids.lab }));
    const rows = await run((tx) => checkoutsFor(tx, "location", ids.lab));
    expect(rows.map((r) => r.state)).toEqual(["open", "returned"]);
    expect(await run((tx) => checkoutsFor(tx, "location", ids.store))).toEqual([]);
  });
});
