import { beforeAll, describe, expect, it } from "vitest";
import { db, withOrg } from "@/db";
import { assets, categories, organizations, users } from "@/db/schema";
import { duplicateAsset, nextTags, prefixFrom, type Actor } from "./custody";

let actor: Actor;
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Tags ${Date.now()}` }).returning();
  const [u] = await db.insert(users).values({ orgId: org.id, name: "Admin", email: `tags-${Date.now()}@test.local`, passwordHash: "x", role: "owner" }).returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
});

describe("category asset tags", () => {
  it("derives a prefix from the category name", () => {
    expect(prefixFrom("Desktop")).toBe("DESK");
    expect(prefixFrom("Hard disk")).toBe("HARD");
    expect(prefixFrom("पेन")).toBe("");
  });

  it("numbers per prefix, continues after existing tags, and falls back to the org's numbering", async () => {
    const [desk, mine, other] = await run((tx) =>
      tx.insert(categories).values([{ orgId: actor.orgId, name: "Desktop" }, { orgId: actor.orgId, name: "Monitor", tagPrefix: "DEST" }, { orgId: actor.orgId, name: "Desks" }]).returning(),
    );
    await run((tx) => tx.insert(assets).values({ orgId: actor.orgId, tag: "DEST-001200", name: "Old desktop" }));

    const tags = await run((tx) => nextTags(tx, actor.orgId, [desk.id, mine.id, desk.id, null, mine.id]));
    expect(tags.slice(0, 3)).toEqual(["DESK-000001", "DEST-001201", "DESK-000002"]);
    expect(tags[3]).toMatch(/^TN-\d{6}$/);
    expect(tags[4]).toBe("DEST-001202");

    // "Desks" shares DESK with "Desktop": the numbers continue instead of repeating.
    const [a] = await run((tx) => tx.insert(assets).values({ orgId: actor.orgId, tag: tags[0], name: "PC", categoryId: desk.id }).returning());
    expect(await run((tx) => nextTags(tx, actor.orgId, [other.id]))).toEqual(["DESK-000002"]);
    const copies = await run((tx) => duplicateAsset(tx, actor, { assetId: a.id, copies: 2 }));
    expect(copies.map((c) => c.tag)).toEqual(["DESK-000002", "DESK-000003"]);
  });
});
