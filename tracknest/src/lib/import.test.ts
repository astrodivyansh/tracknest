import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assetEvents, assets, categories, customFields, locations, organizations, persons, sites, users } from "@/db/schema";
import type { Actor } from "./custody";
import { importAssets, importPeople } from "./import";

let actor: Actor;

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Import ${Date.now()}` }).returning();
  const [u] = await db
    .insert(users)
    .values({ orgId: org.id, name: "Admin", email: `imp-${Date.now()}@test.local`, passwordHash: "x", role: "owner" })
    .returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
  await withOrg(org.id, async (tx) => {
    const [s] = await tx.insert(sites).values({ orgId: org.id, name: "Head Office" }).returning();
    await tx.insert(locations).values({ orgId: org.id, siteId: s.id, name: "Floor 2" });
  });
});

const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);

describe("asset import", () => {
  it("imports valid rows with auto tags, lookups and a history record each", async () => {
    const csv =
      "Asset Tag,Name,Category,Location,Purchase Date,Cost,Colour\n" +
      ",Laptop A,Laptops,floor 2,15/04/2026,\"85,000\",red\n" +
      "CUSTOM-1,Chair,Furniture,,,,\n";
    const r = await run((tx) => importAssets(tx, actor, csv));
    expect(r).toEqual({ imported: 2, skipped: 0, ignored: ["Colour"] });

    const rows = await run((tx) => tx.select().from(assets).orderBy(assets.name));
    expect(rows.map((a) => [a.tag, a.name, a.purchaseDate, a.cost])).toEqual([
      ["CUSTOM-1", "Chair", null, null],
      ["TN-000001", "Laptop A", "2026-04-15", "85000.00"],
    ]);
    expect(rows[1].locationId).not.toBeNull();
    expect(rows[1].siteId).not.toBeNull();
    expect((await run((tx) => tx.select().from(categories))).map((c) => c.name).sort()).toEqual(["Furniture", "Laptops"]);
    const events = await run((tx) => tx.select().from(assetEvents).where(eq(assetEvents.source, "import")));
    expect(events).toHaveLength(2);
  });

  it("imports nothing when any row is invalid, and lists the bad rows", async () => {
    const before = (await run((tx) => tx.select().from(assets))).length;
    const csv = "name,location,cost,tag\nGood one,,,\n,,,\n , ,1,\nLamp,,abc,\n";
    await expect(run((tx) => importAssets(tx, actor, csv))).rejects.toThrow(/Row 4: Asset name is required\nRow 5: Cost/);
    await expect(run((tx) => importAssets(tx, actor, "name,location\nDesk,Basement\n"))).rejects.toThrow(/Row 2: location “Basement”/);
    await expect(run((tx) => importAssets(tx, actor, "name,tag\nX,CUSTOM-1\n"))).rejects.toThrow(/already used/);
    expect((await run((tx) => tx.select().from(assets))).length).toBe(before);
  });
});

describe("people import", () => {
  it("skips people already on file so re-uploads are safe", async () => {
    const csv = "name,email,employee id,department\nPriya,PRIYA@x.com,E1,Finance\nRavi,,E2,\nPriya again,priya@x.com,,\n";
    expect(await run((tx) => importPeople(tx, actor, csv))).toMatchObject({ imported: 2, skipped: 1 });
    expect(await run((tx) => importPeople(tx, actor, csv))).toMatchObject({ imported: 0, skipped: 3 });
    expect(await run((tx) => tx.select().from(persons))).toHaveLength(2);
  });
});

describe("custom fields in import", () => {
  it("fills fields from columns named like them and validates them per row", async () => {
    await run((tx) =>
      tx.insert(customFields).values([
        { orgId: actor.orgId, label: "Warranty expiry", type: "date", required: true },
        { orgId: actor.orgId, label: "OS", type: "select", options: ["Windows", "macOS"] },
      ]),
    );
    await expect(run((tx) => importAssets(tx, actor, "name,warranty expiry,os\nA,,Windows\nB,2027-01-01,BeOS\n"))).rejects.toThrow(
      /Row 2: Warranty expiry is required\.\nRow 3: OS must be one of: Windows, macOS\./,
    );
    const r = await run((tx) => importAssets(tx, actor, "name,Warranty Expiry,OS\nScanner,31/03/2028,macos\n"));
    expect(r.ignored).toEqual([]);
    const [a] = await run((tx) => tx.select().from(assets).where(eq(assets.name, "Scanner")));
    expect(Object.values(a.custom).sort()).toEqual(["2028-03-31", "macOS"]);
  });
});
