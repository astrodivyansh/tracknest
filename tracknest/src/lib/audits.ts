import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { assets, auditItems, audits, locations } from "@/db/schema";
import { changeStatus, CustodyError, holderName, recordEvent, type Actor } from "./custody";
import { tagFrom } from "./tags";

// Assets that should physically be on the shelf. Checked-out ones are with their holder;
// maintenance ones are at the vendor; disposed ones are gone.
const COUNTABLE = ["available", "broken", "lost"] as const;

/** Upper-cased, de-duplicated tags from pasted text (one per line, or separated by commas/spaces). */
export const parseTags = (text: string) => [...new Set(text.split(/[\s,;]+/).map((t) => tagFrom(t).toUpperCase()).filter(Boolean))];

/**
 * Starts an audit and snapshots which assets are expected: those in a place (optionally only one
 * category and its sub-categories), or exactly the pasted `tags` (any status except disposed).
 */
export async function startAudit(
  tx: Tx,
  actor: Actor,
  input: { name: string; siteId?: string | null; locationId?: string | null; categoryId?: string | null; tags?: string[] },
) {
  const byList = !!input.tags?.length;
  let siteId = input.siteId ?? null;
  if (input.locationId) {
    const [loc] = await tx.select({ siteId: locations.siteId }).from(locations).where(eq(locations.id, input.locationId));
    if (!loc) throw new CustodyError("That location doesn't exist.");
    siteId = loc.siteId;
  }
  const [audit] = await tx
    .insert(audits)
    .values({
      orgId: actor.orgId,
      name: input.name,
      siteId: byList ? null : siteId,
      locationId: byList ? null : (input.locationId ?? null),
      categoryId: byList ? null : (input.categoryId ?? null),
      byList,
      createdBy: actor.name,
    })
    .returning();

  const cols = { assetId: assets.id, expectedLocationId: assets.locationId, tag: assets.tag };
  const place = input.locationId ? eq(assets.locationId, input.locationId) : siteId ? eq(assets.siteId, siteId) : undefined;
  const category = input.categoryId
    ? sql`${assets.categoryId} in (select id from categories where id = ${input.categoryId} or parent_id = ${input.categoryId})`
    : undefined;
  const expected = await tx
    .select(cols)
    .from(assets)
    .where(
      byList
        ? and(isNull(assets.deletedAt), ne(assets.status, "disposed"), inArray(sql`upper(${assets.tag})`, input.tags!))
        : and(isNull(assets.deletedAt), inArray(assets.status, [...COUNTABLE]), place, category),
    );
  const unknown = byList ? input.tags!.filter((t) => !expected.some((e) => e.tag.toUpperCase() === t)) : [];
  if (unknown.length) {
    throw new CustodyError(`No active asset has the tag${unknown.length > 1 ? "s" : ""} ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? "…" : ""}.`);
  }
  for (let i = 0; i < expected.length; i += 1000) {
    await tx
      .insert(auditItems)
      .values(expected.slice(i, i + 1000).map(({ assetId, expectedLocationId }) => ({ assetId, expectedLocationId, orgId: actor.orgId, auditId: audit.id, expected: true })));
  }
  return audit;
}

async function openAudit(tx: Tx, auditId: string) {
  const [audit] = await tx.select().from(audits).where(eq(audits.id, auditId)).for("update");
  if (!audit) throw new CustodyError("Audit not found.");
  if (audit.state !== "open") throw new CustodyError("This audit is closed.");
  return audit;
}

export type ScanOutcome = "found" | "misplaced" | "unexpected" | "already";

/** Records one scanned label at `locationId` (where the auditor is standing). */
export async function recordScan(
  tx: Tx,
  actor: Actor,
  input: { auditId: string; raw: string; locationId?: string | null },
): Promise<{ tag: string; name: string; outcome: ScanOutcome }> {
  await openAudit(tx, input.auditId);
  const tag = tagFrom(input.raw);
  const [asset] = await tx
    .select({ id: assets.id, tag: assets.tag, name: assets.name })
    .from(assets)
    .where(and(eq(assets.tag, tag), isNull(assets.deletedAt)));
  if (!asset) throw new CustodyError(`No asset with tag ${tag}.`);
  const where = input.locationId || null;
  if (where) await holderName(tx, "location", where); // validates the location

  const [item] = await tx
    .select()
    .from(auditItems)
    .where(and(eq(auditItems.auditId, input.auditId), eq(auditItems.assetId, asset.id)))
    .for("update");
  const found = { result: "found" as const, foundLocationId: where, foundAt: new Date(), foundBy: actor.name };
  if (item?.result === "found") return { ...asset, outcome: "already" };
  if (item) {
    await tx.update(auditItems).set(found).where(eq(auditItems.id, item.id));
    const misplaced = where && item.expectedLocationId && where !== item.expectedLocationId;
    return { ...asset, outcome: misplaced ? "misplaced" : "found" };
  }
  await tx.insert(auditItems).values({ orgId: actor.orgId, auditId: input.auditId, assetId: asset.id, expected: false, ...found });
  return { ...asset, outcome: "unexpected" };
}

/**
 * Closes the audit: anything expected but not scanned becomes missing, and every item gets an
 * "audited" entry in its asset's history. Optionally applies the results to the assets.
 */
export async function closeAudit(
  tx: Tx,
  actor: Actor,
  input: { auditId: string; markMissingLost?: boolean; applyFound?: boolean },
) {
  const audit = await openAudit(tx, input.auditId);
  await tx
    .update(auditItems)
    .set({ result: "missing" })
    .where(and(eq(auditItems.auditId, audit.id), isNull(auditItems.result)));

  const items = await tx
    .select({
      assetId: auditItems.assetId,
      result: auditItems.result,
      foundLocationId: auditItems.foundLocationId,
      foundLocationName: locations.name,
      foundSiteId: locations.siteId,
    })
    .from(auditItems)
    .leftJoin(locations, eq(locations.id, auditItems.foundLocationId))
    .where(eq(auditItems.auditId, audit.id));

  // shortcut: one asset at a time in a single transaction; fine for a few thousand items, batch it beyond that.
  const counts = { found: 0, missing: 0, moved: 0, markedLost: 0, markedFound: 0 };
  for (const it of items) {
    const [asset] = await tx.select().from(assets).where(eq(assets.id, it.assetId)).for("update");
    const payload: Record<string, unknown> = { auditId: audit.id, auditName: audit.name, result: it.result };
    if (it.result === "found") {
      counts.found++;
      payload.locationName = it.foundLocationName;
      const movable = !asset.deletedAt && asset.status !== "checked_out" && asset.status !== "disposed";
      if (input.applyFound && movable && it.foundLocationId && it.foundLocationId !== asset.locationId) {
        const [from] = asset.locationId
          ? await tx.select({ name: locations.name }).from(locations).where(eq(locations.id, asset.locationId))
          : [];
        await tx
          .update(assets)
          .set({ locationId: it.foundLocationId, siteId: it.foundSiteId, updatedAt: new Date() })
          .where(eq(assets.id, asset.id));
        payload.movedFrom = from?.name ?? null;
        counts.moved++;
      }
      await recordEvent(tx, actor, asset.id, "audited", payload);
      if (input.applyFound && asset.status === "lost") {
        await changeStatus(tx, actor, { assetId: asset.id, to: "available", reason: `Found in audit “${audit.name}”` });
        counts.markedFound++;
      }
    } else {
      counts.missing++;
      await recordEvent(tx, actor, asset.id, "audited", payload);
      if (input.markMissingLost && (asset.status === "available" || asset.status === "broken")) {
        await changeStatus(tx, actor, { assetId: asset.id, to: "lost", reason: `Not found in audit “${audit.name}”` });
        counts.markedLost++;
      }
    }
  }
  await tx.update(audits).set({ state: "closed", closedAt: new Date(), closedBy: actor.name }).where(eq(audits.id, audit.id));
  return counts;
}
