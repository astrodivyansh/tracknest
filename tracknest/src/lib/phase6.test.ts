import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assetEvents, assetRecords, assets, categories, customers, inventoryItems, inventoryMoves, locations, organizations, sites, users, warranties } from "@/db/schema";
import { applyFormSetup, formLayout } from "./asset-form-setup";
import { nextTag, type Actor } from "./custody";
import { widgetsFor } from "./dashboard-widgets";
import { EXPORTS } from "./data-export";
import { IMPORTERS } from "./import-more";
import { moveStock } from "./inventory";
import { deleteRecord, linkRecord, unlinkRecord } from "./records";

let actor: Actor;
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);
const newAsset = (name = "Printer") =>
  run(async (tx) => (await tx.insert(assets).values({ orgId: actor.orgId, tag: await nextTag(tx, actor.orgId), name }).returning())[0]);

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `P6 ${Date.now()}` }).returning();
  const [u] = await db.insert(users).values({ orgId: org.id, name: "Admin", email: `p6-${Date.now()}@test.local`, passwordHash: "x", role: "owner" }).returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
});

describe("inventory", () => {
  it("tracks a balance, refuses to go below zero, and keeps every movement", async () => {
    const [item] = await run((tx) => tx.insert(inventoryItems).values({ orgId: actor.orgId, name: "Toner" }).returning());
    const move = (kind: "received" | "issued" | "counted", quantity: number) => run((tx) => moveStock(tx, actor, { itemId: item.id, kind, quantity }));
    expect(await move("received", 10)).toBe(10);
    expect(await move("issued", 3)).toBe(7);
    await expect(move("issued", 8)).rejects.toThrow(/Only 7/);
    expect(await move("counted", 5)).toBe(5);
    const moves = await run((tx) => tx.select().from(inventoryMoves).where(eq(inventoryMoves.itemId, item.id)).orderBy(asc(inventoryMoves.occurredAt)));
    expect(moves.map((m) => [m.kind, Number(m.change), Number(m.balance)])).toEqual([["received", 10, 10], ["issued", -3, 7], ["counted", -2, 5]]);
    await expect(run((tx) => tx.delete(inventoryMoves).where(eq(inventoryMoves.itemId, item.id)))).rejects.toThrow();
  });

  it("two people can't issue the last unit", async () => {
    const [item] = await run((tx) => tx.insert(inventoryItems).values({ orgId: actor.orgId, name: "Cable" }).returning());
    await run((tx) => moveStock(tx, actor, { itemId: item.id, kind: "received", quantity: 1 }));
    const issue = () => run((tx) => moveStock(tx, actor, { itemId: item.id, kind: "issued", quantity: 1 }));
    const results = await Promise.allSettled([issue(), issue()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("contracts, insurance and funding", () => {
  it("links by tag, notes it in asset history, and survives deletion", async () => {
    const [a, b] = [await newAsset(), await newAsset()];
    const [r] = await run((tx) => tx.insert(assetRecords).values({ orgId: actor.orgId, kind: "contract", name: "AMC", createdBy: "t" }).returning());
    await expect(run((tx) => linkRecord(tx, actor, { recordId: r.id, tags: [a.tag, "NOPE-1"] }))).rejects.toThrow(/NOPE-1/);
    expect(await run((tx) => linkRecord(tx, actor, { recordId: r.id, tags: [a.tag, b.tag] }))).toBe(2);
    expect(await run((tx) => linkRecord(tx, actor, { recordId: r.id, tags: [a.tag] }))).toBe(0); // already linked
    await run((tx) => unlinkRecord(tx, actor, { recordId: r.id, assetId: a.id }));
    await run((tx) => deleteRecord(tx, actor, r.id));
    const types = async (id: string) => (await run((tx) => tx.select().from(assetEvents).where(eq(assetEvents.assetId, id)).orderBy(asc(assetEvents.occurredAt)))).map((e) => e.type);
    expect(await types(a.id)).toEqual(["record_linked", "record_unlinked"]);
    expect(await types(b.id)).toEqual(["record_linked", "record_unlinked"]);
  });
});

describe("importers and exports", () => {
  const imp = (table: string, text: string) => run((tx) => IMPORTERS[table].run(tx, actor, text));

  it("every template imports, and re-importing skips what's on file", async () => {
    const asset = await newAsset();
    for (const [k, i] of Object.entries(IMPORTERS)) {
      const text = i.template.replace(/TN-000001/g, asset.tag);
      const r = await imp(k, text);
      expect(r.imported, k).toBeGreaterThan(0);
    }
    const again = await imp("customers", IMPORTERS.customers.template);
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
    const [sub] = await run((tx) => tx.select({ parentId: categories.parentId }).from(categories).where(eq(categories.name, "Laptops")));
    expect(sub.parentId).not.toBeNull();
    expect((await run((tx) => tx.select().from(locations))).length).toBe(2);
    expect((await run((tx) => tx.select().from(sites))).length).toBe(1);
    expect((await run((tx) => tx.select().from(warranties).where(eq(warranties.assetId, asset.id)))).length).toBe(1);
    expect((await run((tx) => tx.select().from(customers))).length).toBe(1);
  });

  it("a bad row imports nothing", async () => {
    await expect(imp("warranties", "tag,name,ends\r\nNOPE-1,Dell,2028-01-01\r\n")).rejects.toThrow(/NOPE-1/);
    await expect(imp("records", "kind,name\r\nbogus,X\r\n")).rejects.toThrow(/Row 2/);
    await expect(imp("categories", "name,parent\r\nDeep,Laptops\r\n")).rejects.toThrow(/already a sub-category/);
  });

  it("every export has one cell per header", async () => {
    for (const [k, t] of Object.entries(EXPORTS)) {
      const rows = await run(t.rows);
      for (const r of rows) expect(r.length, k).toBe(t.header.length);
    }
    expect((await run(EXPORTS.inventory.rows)).length).toBeGreaterThan(0);
  });
});

describe("form designer", () => {
  const setup = { brand: { hidden: true }, serial: { required: true, label: "Service tag" }, cost: { position: 1 } };
  it("hidden fields keep saved values, new assets leave them empty, required is enforced", () => {
    const input = { brand: null, serial: "S1", cost: "5.00" };
    expect(applyFormSetup(input, setup, { brand: "Dell" }).brand).toBe("Dell");
    expect(applyFormSetup({ ...input, brand: "Sneaky" }, setup).brand).toBeNull();
    expect(() => applyFormSetup({ ...input, serial: null }, setup)).toThrow(/Service tag is required/);
  });
  it("orders and labels the visible fields", () => {
    const layout = formLayout(setup);
    expect(layout[0].key).toBe("categoryId"); // position 1, first by default order
    expect(layout[1].key).toBe("cost");
    expect(layout.some((f) => f.key === "brand")).toBe(false);
    expect(layout.find((f) => f.key === "serial")?.label).toBe("Service tag");
  });
});

describe("dashboard layout", () => {
  it("defaults to everything and ignores unknown widgets", () => {
    expect(widgetsFor(null)).toContain("kpis");
    expect(widgetsFor(["calendar", "gone", "kpis"])).toEqual(["calendar", "kpis"]);
    expect(widgetsFor([])).toEqual([]);
  });
});
