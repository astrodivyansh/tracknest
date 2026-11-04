import { and, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { assets, ASSET_STATUSES, HOLDER_TYPES, locations, type AssetStatus } from "@/db/schema";
import { CustodyError, nextTag, recordEvent, type Actor } from "./custody";
import { optId, optText, reqText } from "./form";

type Params = Record<string, string | string[] | undefined>;

/** Asset list search and filters, shared by the list page, label printing and the API. */
export function assetFilters(sp: Params) {
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" && (ASSET_STATUSES as readonly string[]).includes(sp.status) ? (sp.status as AssetStatus) : "";
  const where: SQL[] = [isNull(assets.deletedAt)];
  if (q) {
    const like = `%${q}%`;
    where.push(
      or(
        ilike(assets.tag, like),
        ilike(assets.name, like),
        ilike(assets.serial, like),
        ilike(assets.model, like),
        // custom field values only (the keys are field ids)
        sql`exists (select 1 from jsonb_each_text(${assets.custom}) cf where cf.value ilike ${like})`,
      )!,
    );
  }
  if (status) where.push(eq(assets.status, status));
  // Ids that aren't UUIDs are ignored rather than erroring, like an unknown status.
  const id = (v: unknown) => (typeof v === "string" && z.uuid().safeParse(v).success ? v : "");
  const categoryId = id(sp.categoryId);
  const locationId = id(sp.locationId);
  const departmentId = id(sp.departmentId);
  // A category includes its sub-categories.
  if (categoryId) where.push(sql`${assets.categoryId} in (select id from categories where id = ${categoryId} or parent_id = ${categoryId})`);
  if (locationId) where.push(eq(assets.locationId, locationId));
  if (departmentId) where.push(eq(assets.departmentId, departmentId));
  /** The active filters, for links that must keep them (paging, label printing). */
  const params = Object.fromEntries(Object.entries({ q, status, categoryId, locationId, departmentId }).filter(([, v]) => v)) as Record<string, string>;
  return { q, status, categoryId, locationId, departmentId, where, params };
}

export const optDate = z
  .union([z.literal(""), z.iso.date("Enter a valid date")])
  .optional()
  .transform((v) => v || null);

export const assetSchema = z.object({
  tag: optText,
  name: reqText("Asset name"),
  categoryId: optId,
  brand: optText,
  model: optText,
  serial: optText,
  purchaseDate: optDate,
  cost: z
    .union([z.literal(""), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Cost must be a number like 1250.50")])
    .optional()
    .transform((v) => (v ? Number(v).toFixed(2) : null)), // matches numeric(12,2) so edits diff cleanly
  purchasedFrom: optText,
  locationId: optId,
  departmentId: optId,
  condition: optText,
  notes: optText,
});

/** "person:<uuid>" etc., as sent by components/holder-select.tsx. */
export const holderSchema = z
  .string()
  .regex(/^(person|location|department|customer):[0-9a-f-]{36}$/, "Choose a person, location, department or customer")
  .transform((v) => {
    const [type, id] = v.split(":");
    return { holderType: type as (typeof HOLDER_TYPES)[number], holderId: id };
  });

// shortcut: loads every available asset into the picker, fine for a few thousand; switch to a search endpoint beyond that.
/** Assets that can be checked out now, for the "assign more" pickers. */
export const availableAssets = (tx: Tx) =>
  tx
    .select({ id: assets.id, tag: assets.tag, name: assets.name })
    .from(assets)
    .where(and(eq(assets.status, "available"), isNull(assets.deletedAt)))
    .orderBy(assets.tag);

export async function siteOf(tx: Tx, locationId: string | null) {
  if (!locationId) return null;
  const [loc] = await tx.select({ siteId: locations.siteId }).from(locations).where(eq(locations.id, locationId));
  if (!loc) throw new CustodyError("That location doesn't exist.");
  return loc.siteId;
}

/** Creates an asset (tag auto-numbered if not given) and its "created" history entry. Used by the web form and the API. */
export async function insertAsset(
  tx: Tx,
  actor: Actor,
  input: z.output<typeof assetSchema> & { custom: Record<string, unknown> },
  source: "web" | "api" = "web",
) {
  const [asset] = await tx
    .insert(assets)
    .values({
      ...input,
      orgId: actor.orgId,
      tag: input.tag ?? (await nextTag(tx, actor.orgId, input.categoryId)),
      siteId: await siteOf(tx, input.locationId),
    })
    .returning();
  await recordEvent(tx, actor, asset.id, "created", { tag: asset.tag, name: asset.name }, { source });
  return asset;
}
