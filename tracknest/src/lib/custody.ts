import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { endOfDayIn, fmtDate } from "./format";
import { STATUS_LABEL } from "./labels";
import {
  assets,
  assetEvents,
  categories,
  checkouts,
  customers,
  departments,
  locations,
  maintenance,
  organizations,
  reservations,
  persons,
  type AssetStatus,
  type EventType,
  type HolderType,
} from "@/db/schema";

/** A rule the user broke (shown to them), as opposed to a bug. */
export class CustodyError extends Error {}

export type Actor = { id: string; name: string; orgId: string };
type Source = "web" | "scanner" | "api" | "import";

export { STATUS_LABEL };

export async function recordEvent(
  tx: Tx,
  actor: Actor,
  assetId: string,
  type: EventType,
  payload: Record<string, unknown> = {},
  opts: { checkoutId?: string; source?: Source } = {},
) {
  await tx.insert(assetEvents).values({
    orgId: actor.orgId,
    assetId,
    type,
    payload,
    checkoutId: opts.checkoutId,
    source: opts.source ?? "web",
    actorId: actor.id,
    actorName: actor.name,
  });
}

/** The org's timezone and today's date there (YYYY-MM-DD). */
export async function orgClock(tx: Tx, orgId: string) {
  const [org] = await tx
    .select({ tz: organizations.timezone, today: sql<string>`(now() at time zone ${organizations.timezone})::date::text` })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return org;
}

/** Today's calendar date in `tz`, as SQL. */
export const todayIn = (tz: string) => sql`(now() at time zone ${tz})::date`;

/** Default tag prefix for a category: first 4 letters/digits of its name, e.g. "Desktop" → DESK. */
export const prefixFrom = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

const fmtTag = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, "0")}`;

/**
 * Reserves one new tag per entry: the category's prefix plus the next free number for that prefix
 * (DESK-000001), or the org's own numbering (TN-000042) when there's no category or no usable prefix.
 */
export async function nextTags(tx: Tx, orgId: string, categoryIds: (string | null)[]) {
  const ids = [...new Set(categoryIds.filter((c): c is string => !!c))];
  const cats = ids.length
    ? await tx.select({ id: categories.id, name: categories.name, tagPrefix: categories.tagPrefix }).from(categories).where(inArray(categories.id, ids))
    : [];
  const prefixOf = new Map(cats.map((c) => [c.id, c.tagPrefix || prefixFrom(c.name)]));
  const prefixes = categoryIds.map((id) => (id && prefixOf.get(id)) || null);

  const orgCount = prefixes.filter((p) => !p).length;
  let org = { prefix: "", seq: 0 };
  if (orgCount) {
    [org] = await tx
      .update(organizations)
      .set({ nextTagSeq: sql`${organizations.nextTagSeq} + ${orgCount}` })
      .where(eq(organizations.id, orgId))
      .returning({ prefix: organizations.tagPrefix, seq: organizations.nextTagSeq });
    org.seq -= orgCount;
  }

  const next = new Map<string, number>();
  for (const p of [...new Set(prefixes.filter((p): p is string => !!p))].sort()) {
    // One writer per prefix until commit, so two assets added at once never get the same number.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${orgId}:tag:${p}`}))`);
    const [{ last }] = await tx
      .select({ last: sql<string>`coalesce(max(substring(${assets.tag} from ${p.length + 2}::int)::bigint), 0)` })
      .from(assets)
      .where(and(eq(assets.orgId, orgId), sql`${assets.tag} ~ ${`^${p}-[0-9]+$`}`));
    next.set(p, Number(last) + 1);
  }
  return prefixes.map((p) => {
    if (!p) return fmtTag(org.prefix, org.seq++);
    const n = next.get(p)!;
    next.set(p, n + 1);
    return fmtTag(p, n);
  });
}

export const nextTag = async (tx: Tx, orgId: string, categoryId: string | null = null) => (await nextTags(tx, orgId, [categoryId]))[0];

export async function holderName(tx: Tx, type: HolderType, id: string) {
  const rows =
    type === "person"
      ? await tx.select({ name: persons.name }).from(persons).where(and(eq(persons.id, id), isNull(persons.deletedAt)))
      : type === "location"
        ? await tx.select({ name: locations.name }).from(locations).where(eq(locations.id, id))
        : type === "customer"
          ? await tx.select({ name: customers.name }).from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt)))
          : await tx.select({ name: departments.name }).from(departments).where(eq(departments.id, id));
  if (!rows[0]) throw new CustodyError(`That ${type} doesn't exist.`);
  return rows[0].name;
}

/**
 * Active bookings of `asset` overlapping today → `dueAt` (open-ended without one). Anyone else's
 * booking is a conflict; the holder's own are returned so a check-out can fulfil them.
 */
async function bookingsDuring(
  tx: Tx,
  tz: string,
  asset: { id: string; tag: string },
  holder: { type: HolderType; id: string },
  dueAt: Date | null,
) {
  const booked = await tx
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.assetId, asset.id),
        eq(reservations.state, "active"),
        sql`${reservations.endDate} >= ${todayIn(tz)}`,
        dueAt ? sql`${reservations.startDate} <= (${dueAt.toISOString()}::timestamptz at time zone ${tz})::date` : undefined,
      ),
    );
  const isMine = (r: (typeof booked)[number]) => r.holderType === holder.type && r.holderId === holder.id;
  const other = booked.find((r) => !isMine(r));
  if (other) {
    const from = fmtDate(other.startDate, "UTC");
    throw new CustodyError(
      `${asset.tag} is reserved for ${other.holderName} from ${from} to ${fmtDate(other.endDate, "UTC")}. ` +
        `Check it out to them, or set a due date before ${from}.`,
    );
  }
  return booked.filter(isMine);
}

// Row lock serialises concurrent check-outs of the same asset.
export async function lockAsset(tx: Tx, assetId: string) {
  const [asset] = await tx
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
    .for("update");
  if (!asset) throw new CustodyError("Asset not found.");
  return asset;
}

async function openCheckout(tx: Tx, assetId: string) {
  const [co] = await tx
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.assetId, assetId), eq(checkouts.state, "open")));
  if (!co) throw new Error(`Asset ${assetId} is checked out but has no open checkout record`);
  return co;
}

export async function checkOut(
  tx: Tx,
  actor: Actor,
  input: {
    assetId: string;
    holderType: HolderType;
    holderId: string;
    dueAt?: Date | null;
    condition?: string | null;
    notes?: string | null;
    source?: Source;
  },
) {
  const asset = await lockAsset(tx, input.assetId);
  if (asset.status !== "available") {
    throw new CustodyError(`${asset.tag} is ${STATUS_LABEL[asset.status].toLowerCase()}; only available assets can be checked out.`);
  }
  if (input.dueAt && input.dueAt.getTime() < Date.now()) throw new CustodyError("Due date is in the past.");
  const name = await holderName(tx, input.holderType, input.holderId);

  const { tz } = await orgClock(tx, actor.orgId);
  const mine = await bookingsDuring(tx, tz, asset, { type: input.holderType, id: input.holderId }, input.dueAt ?? null);
  const dueAt = input.dueAt ?? (mine.length ? endOfDayIn(mine.at(-1)!.endDate, tz) : null);

  const [co] = await tx
    .insert(checkouts)
    .values({
      orgId: actor.orgId,
      assetId: asset.id,
      holderType: input.holderType,
      holderId: input.holderId,
      holderName: name,
      checkedOutBy: actor.id,
      dueAt,
      outCondition: input.condition || null,
      outNotes: input.notes || null,
    })
    .returning();

  await tx
    .update(assets)
    .set({ status: "checked_out", holderType: input.holderType, holderId: input.holderId, updatedAt: new Date() })
    .where(eq(assets.id, asset.id));
  if (mine.length) {
    await tx
      .update(reservations)
      .set({ state: "fulfilled", checkoutId: co.id })
      .where(inArray(reservations.id, mine.map((r) => r.id)));
  }

  await recordEvent(
    tx,
    actor,
    asset.id,
    "checked_out",
    {
      holderType: input.holderType,
      holderId: input.holderId,
      holderName: name,
      dueAt: dueAt?.toISOString() ?? null,
      condition: input.condition || null,
      notes: input.notes || null,
    },
    { checkoutId: co.id, source: input.source },
  );
  return co;
}

export async function checkIn(
  tx: Tx,
  actor: Actor,
  input: {
    assetId: string;
    returnLocationId?: string | null;
    condition?: string | null;
    notes?: string | null;
    source?: Source;
  },
) {
  const asset = await lockAsset(tx, input.assetId);
  if (asset.status !== "checked_out") throw new CustodyError(`${asset.tag} is not checked out.`);
  const co = await openCheckout(tx, asset.id);
  const returnLocationName = input.returnLocationId ? await holderName(tx, "location", input.returnLocationId) : null;
  const now = new Date();

  await tx
    .update(checkouts)
    .set({
      state: "returned",
      checkedInBy: actor.id,
      checkedInAt: now,
      returnLocationId: input.returnLocationId || null,
      inCondition: input.condition || null,
      inNotes: input.notes || null,
    })
    .where(eq(checkouts.id, co.id));

  await tx
    .update(assets)
    .set({
      status: input.condition === "Damaged" ? "broken" : "available",
      holderType: null,
      holderId: null,
      locationId: input.returnLocationId || asset.locationId,
      condition: input.condition || asset.condition,
      updatedAt: now,
    })
    .where(eq(assets.id, asset.id));

  await recordEvent(
    tx,
    actor,
    asset.id,
    "checked_in",
    {
      holderType: co.holderType,
      holderName: co.holderName,
      returnLocationName,
      condition: input.condition || null,
      notes: input.notes || null,
      daysHeld: Math.max(0, Math.round((now.getTime() - co.checkedOutAt.getTime()) / 864e5)),
    },
    { checkoutId: co.id, source: input.source },
  );
}

export async function extendDue(tx: Tx, actor: Actor, input: { assetId: string; dueAt: Date }) {
  const asset = await lockAsset(tx, input.assetId);
  if (asset.status !== "checked_out") throw new CustodyError(`${asset.tag} is not checked out.`);
  if (input.dueAt.getTime() < Date.now()) throw new CustodyError("Due date is in the past.");
  const co = await openCheckout(tx, asset.id);
  await bookingsDuring(tx, (await orgClock(tx, actor.orgId)).tz, asset, { type: co.holderType, id: co.holderId }, input.dueAt);
  await tx.update(checkouts).set({ dueAt: input.dueAt }).where(eq(checkouts.id, co.id));
  await recordEvent(
    tx,
    actor,
    asset.id,
    "due_extended",
    { holderName: co.holderName, from: co.dueAt?.toISOString() ?? null, to: input.dueAt.toISOString() },
    { checkoutId: co.id },
  );
}

/**
 * Manual status moves. Checked-out is handled only by checkOut/checkIn, and going into
 * maintenance only by a maintenance job (lib/maintenance.ts); disposed is final.
 */
export const STATUS_MOVES: Record<AssetStatus, { to: AssetStatus; label: string }[]> = {
  available: [
    { to: "broken", label: "Mark broken" },
    { to: "lost", label: "Mark lost / missing" },
    { to: "disposed", label: "Dispose / sell / write off" },
  ],
  under_maintenance: [
    { to: "available", label: "Back from maintenance" },
    { to: "broken", label: "Mark broken" },
    { to: "disposed", label: "Dispose / sell / write off" },
  ],
  broken: [
    { to: "available", label: "Mark repaired" },
    { to: "disposed", label: "Dispose / sell / write off" },
  ],
  lost: [
    { to: "available", label: "Mark found" },
    { to: "disposed", label: "Write off" },
  ],
  checked_out: [],
  disposed: [],
};

export const DISPOSAL_LABEL = { sold: "Sold", scrapped: "Scrapped", donated: "Donated", written_off: "Written off" } as const;
export type Disposal = { on: string; method: keyof typeof DISPOSAL_LABEL; value?: string | null };

export async function changeStatus(
  tx: Tx,
  actor: Actor,
  input: { assetId: string; to: AssetStatus; reason?: string | null; disposal?: Disposal },
) {
  const asset = await lockAsset(tx, input.assetId);
  if (asset.status === "checked_out") throw new CustodyError(`${asset.tag} is checked out. Check it in first.`);
  if (asset.status === "under_maintenance") {
    const [job] = await tx
      .select({ id: maintenance.id })
      .from(maintenance)
      .where(and(eq(maintenance.assetId, asset.id), eq(maintenance.state, "in_progress")));
    if (job) throw new CustodyError(`${asset.tag} has a maintenance job in progress. Complete that job instead.`);
  }
  if (!STATUS_MOVES[asset.status].some((m) => m.to === input.to)) {
    throw new CustodyError(`${asset.tag} can't go from ${STATUS_LABEL[asset.status]} to ${STATUS_LABEL[input.to]}.`);
  }
  const d = input.to === "disposed" ? input.disposal : undefined;
  if (input.to === "disposed") {
    if (!input.reason) throw new CustodyError("Give a reason for disposing of the asset.");
    if (!d) throw new CustodyError("Say how and when the asset was disposed of.");
    if (d.on > (await orgClock(tx, actor.orgId)).today) throw new CustodyError("The disposal date is in the future.");
    if (asset.purchaseDate && d.on < asset.purchaseDate) throw new CustodyError("The disposal date is before the purchase date.");
  }
  await tx
    .update(assets)
    .set({
      status: input.to,
      updatedAt: new Date(),
      ...(d && { disposedOn: d.on, disposalMethod: d.method, disposalValue: d.value || null }),
    })
    .where(eq(assets.id, asset.id));
  await recordEvent(tx, actor, asset.id, "status_changed", {
    from: asset.status,
    to: input.to,
    reason: input.reason || null,
    ...(d && { disposal: { on: d.on, method: d.method, value: d.value || null } }),
  });
}

/**
 * Hides an asset entered by mistake (use "disposed" for real disposals). Its tag stays taken and its
 * history stays. Scheduled maintenance is cancelled so no more reminders go out.
 */
export async function archiveAsset(tx: Tx, actor: Actor, input: { assetId: string; reason: string }) {
  const asset = await lockAsset(tx, input.assetId);
  if (asset.status === "checked_out" || asset.status === "under_maintenance") {
    throw new CustodyError(`${asset.tag} is ${STATUS_LABEL[asset.status].toLowerCase()}. Bring it back first.`);
  }
  const now = new Date();
  await tx
    .update(maintenance)
    .set({ state: "cancelled", completionNotes: "Asset archived", closedAt: now, closedBy: actor.name })
    .where(and(eq(maintenance.assetId, asset.id), eq(maintenance.state, "scheduled")));
  await tx.update(assets).set({ deletedAt: now, updatedAt: now }).where(eq(assets.id, asset.id));
  await recordEvent(tx, actor, asset.id, "archived", { reason: input.reason });
}

/**
 * Moves an asset to another location and/or department without checking it out (null keeps the
 * current one). Linked children move with their parent. Returns false if nothing changed.
 */
export async function moveAsset(
  tx: Tx,
  actor: Actor,
  input: { assetId: string; locationId: string | null; departmentId: string | null },
) {
  const asset = await lockAsset(tx, input.assetId);
  if (asset.status === "disposed") throw new CustodyError(`${asset.tag} is disposed.`);
  const locationId = input.locationId ?? asset.locationId;
  const departmentId = input.departmentId ?? asset.departmentId;
  if (locationId === asset.locationId && departmentId === asset.departmentId) return false;
  const name = async (type: "location" | "department", id: string | null) => (id ? holderName(tx, type, id) : null);
  const [loc] = locationId ? await tx.select({ siteId: locations.siteId }).from(locations).where(eq(locations.id, locationId)) : [];
  const now = new Date();
  await tx
    .update(assets)
    .set({ locationId, siteId: loc?.siteId ?? asset.siteId, departmentId, updatedAt: now })
    .where(eq(assets.id, asset.id));
  await recordEvent(tx, actor, asset.id, "moved", {
    ...(locationId !== asset.locationId && { fromLocation: await name("location", asset.locationId), toLocation: await name("location", locationId) }),
    ...(departmentId !== asset.departmentId && {
      fromDepartment: await name("department", asset.departmentId),
      toDepartment: await name("department", departmentId),
    }),
  });
  const children = await tx
    .select({ id: assets.id, locationId: assets.locationId, departmentId: assets.departmentId })
    .from(assets)
    .where(and(eq(assets.parentId, asset.id), isNull(assets.deletedAt), sql`${assets.status} <> 'disposed'`));
  for (const c of children) await moveAsset(tx, actor, { assetId: c.id, locationId: input.locationId, departmentId: input.departmentId });
  return true;
}

/** Links `childId` under the asset tagged `parentTag`. One level only: parents can't have parents. */
export async function linkAsset(tx: Tx, actor: Actor, input: { childId: string; parentTag: string }) {
  const child = await lockAsset(tx, input.childId);
  const [parent] = await tx
    .select()
    .from(assets)
    .where(and(sql`lower(${assets.tag}) = lower(${input.parentTag.trim()})`, isNull(assets.deletedAt)))
    .for("update");
  if (!parent) throw new CustodyError(`No asset has the tag ${input.parentTag}.`);
  if (parent.id === child.id) throw new CustodyError("An asset can't be linked to itself.");
  if (child.parentId) throw new CustodyError(`${child.tag} is already linked. Unlink it first.`);
  if (parent.parentId) throw new CustodyError(`${parent.tag} is itself linked to another asset.`);
  const [grandchild] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.parentId, child.id)).limit(1);
  if (grandchild) throw new CustodyError(`${child.tag} has its own linked assets, so it can't go under another.`);
  await tx.update(assets).set({ parentId: parent.id, updatedAt: new Date() }).where(eq(assets.id, child.id));
  await recordEvent(tx, actor, child.id, "linked", { role: "child", otherTag: parent.tag, otherName: parent.name });
  await recordEvent(tx, actor, parent.id, "linked", { role: "parent", otherTag: child.tag, otherName: child.name });
}

export async function unlinkAsset(tx: Tx, actor: Actor, input: { childId: string }) {
  const child = await lockAsset(tx, input.childId);
  if (!child.parentId) throw new CustodyError(`${child.tag} isn't linked.`);
  const [parent] = await tx.select().from(assets).where(eq(assets.id, child.parentId));
  await tx.update(assets).set({ parentId: null, updatedAt: new Date() }).where(eq(assets.id, child.id));
  await recordEvent(tx, actor, child.id, "unlinked", { role: "child", otherTag: parent.tag, otherName: parent.name });
  await recordEvent(tx, actor, parent.id, "unlinked", { role: "parent", otherTag: child.tag, otherName: child.name });
}

/** Copies an asset `copies` times with new tags. Serial numbers, holder and history aren't copied. */
export async function duplicateAsset(tx: Tx, actor: Actor, input: { assetId: string; copies: number }) {
  const a = await lockAsset(tx, input.assetId);
  if (input.copies < 1 || input.copies > 50) throw new CustodyError("Make between 1 and 50 copies.");
  const tags = await nextTags(tx, actor.orgId, Array(input.copies).fill(a.categoryId));
  const rows = await tx
    .insert(assets)
    .values(
      tags.map((tag) => ({
        orgId: actor.orgId,
        tag,
        name: a.name,
        categoryId: a.categoryId,
        brand: a.brand,
        model: a.model,
        purchaseDate: a.purchaseDate,
        cost: a.cost,
        purchasedFrom: a.purchasedFrom,
        siteId: a.siteId,
        locationId: a.locationId,
        departmentId: a.departmentId,
        condition: a.condition,
        notes: a.notes,
        custom: a.custom,
      })),
    )
    .returning({ id: assets.id, tag: assets.tag, name: assets.name });
  for (const r of rows) await recordEvent(tx, actor, r.id, "created", { tag: r.tag, name: r.name, copiedFrom: a.tag });
  return rows;
}
