import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import type { Tx } from "@/db";
import { assets, categories, checkouts, customFields, departments, locations, sites } from "@/db/schema";
import { ApiError, type ApiCtx } from "./api";
import { describeEvent } from "./format";

/** Assets in the API's shape (openapi.yaml#/components/schemas/Asset). */
export async function loadAssets(tx: Tx, ctx: ApiCtx, where: SQL[], page: { limit: number; offset: number }) {
  const [rows, defs] = await Promise.all([
    tx
      .select({
        a: assets,
        category: categories.name,
        site: sites.name,
        location: locations.name,
        department: departments.name,
        co: checkouts,
      })
      .from(assets)
      .leftJoin(categories, eq(categories.id, assets.categoryId))
      .leftJoin(sites, eq(sites.id, assets.siteId))
      .leftJoin(locations, eq(locations.id, assets.locationId))
      .leftJoin(departments, eq(departments.id, assets.departmentId))
      .leftJoin(checkouts, and(eq(checkouts.assetId, assets.id), eq(checkouts.state, "open")))
      .where(and(...where))
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(page.limit)
      .offset(page.offset),
    tx.select({ id: customFields.id, label: customFields.label }).from(customFields),
  ]);
  return rows.map(({ a, co, ...names }) => ({
    id: a.id,
    tag: a.tag,
    name: a.name,
    status: a.status,
    ...names,
    brand: a.brand,
    model: a.model,
    serial: a.serial,
    purchaseDate: a.purchaseDate,
    cost: a.cost,
    purchasedFrom: a.purchasedFrom,
    condition: a.condition,
    notes: a.notes,
    holder: co && { type: co.holderType, id: co.holderId, name: co.holderName, checkedOutAt: co.checkedOutAt, dueAt: co.dueAt },
    customFields: Object.fromEntries(defs.filter((d) => d.id in a.custom).map((d) => [d.label, a.custom[d.id]])),
    url: `${ctx.origin}/assets/${a.id}`,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
}

/** The API takes custom fields by label; the form code wants raw strings by field id. */
export async function customByLabel(tx: Tx, input: Record<string, unknown> | undefined) {
  const defs = await tx.select().from(customFields);
  const raw: Record<string, string> = {};
  for (const [label, v] of Object.entries(input ?? {})) {
    const d = defs.find((x) => x.label.toLowerCase() === label.toLowerCase());
    if (!d) throw new ApiError(400, "bad_request", `customFields: no field called “${label}”. See GET /lookups.`);
    raw[d.id] = v === true ? "yes" : v === false || v === null ? "" : String(v);
  }
  return { defs, raw };
}

type EventRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  actorName: string;
  source: string;
  assetTag: string;
};

export const toEvent = (e: EventRow, tz: string) => ({
  id: e.id,
  type: e.type,
  assetTag: e.assetTag,
  occurredAt: e.occurredAt,
  actor: e.actorName,
  source: e.source,
  description: describeEvent(e, tz),
  details: e.payload,
});

/** id of the live asset with this tag, or 404. */
export async function assetIdByTag(tx: Tx, tag: string) {
  const [a] = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.tag, decodeURIComponent(tag)), isNull(assets.deletedAt)));
  if (!a) throw new ApiError(404, "not_found", `No asset with tag ${decodeURIComponent(tag)}.`);
  return a.id;
}

export const oneAsset = async (tx: Tx, ctx: ApiCtx, id: string) => (await loadAssets(tx, ctx, [eq(assets.id, id)], { limit: 1, offset: 0 }))[0];
