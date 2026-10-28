import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  assets,
  assetEvents,
  checkouts,
  departments,
  locations,
  organizations,
  persons,
  type EventType,
  type HolderType,
} from "@/db/schema";

/** A rule the user broke (shown to them), as opposed to a bug. */
export class CustodyError extends Error {}

export type Actor = { id: string; name: string; orgId: string };
type Source = "web" | "scanner" | "api" | "import";

export const STATUS_LABEL: Record<string, string> = {
  available: "Available",
  checked_out: "Checked out",
  under_maintenance: "Under maintenance",
  lost: "Lost / missing",
  broken: "Broken",
  disposed: "Disposed",
};

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

/** Atomically takes the org's next tag number, e.g. TN-000042. */
export async function nextTag(tx: Tx, orgId: string) {
  const [org] = await tx
    .update(organizations)
    .set({ nextTagSeq: sql`${organizations.nextTagSeq} + 1` })
    .where(eq(organizations.id, orgId))
    .returning({ prefix: organizations.tagPrefix, seq: organizations.nextTagSeq });
  return `${org.prefix}-${String(org.seq - 1).padStart(6, "0")}`;
}

export async function holderName(tx: Tx, type: HolderType, id: string) {
  const rows =
    type === "person"
      ? await tx.select({ name: persons.name }).from(persons).where(and(eq(persons.id, id), isNull(persons.deletedAt)))
      : type === "location"
        ? await tx.select({ name: locations.name }).from(locations).where(eq(locations.id, id))
        : await tx.select({ name: departments.name }).from(departments).where(eq(departments.id, id));
  if (!rows[0]) throw new CustodyError(`That ${type} doesn't exist.`);
  return rows[0].name;
}

// Row lock serialises concurrent check-outs of the same asset.
async function lockAsset(tx: Tx, assetId: string) {
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

  const [co] = await tx
    .insert(checkouts)
    .values({
      orgId: actor.orgId,
      assetId: asset.id,
      holderType: input.holderType,
      holderId: input.holderId,
      holderName: name,
      checkedOutBy: actor.id,
      dueAt: input.dueAt ?? null,
      outCondition: input.condition || null,
      outNotes: input.notes || null,
    })
    .returning();

  await tx
    .update(assets)
    .set({ status: "checked_out", holderType: input.holderType, holderId: input.holderId, updatedAt: new Date() })
    .where(eq(assets.id, asset.id));

  await recordEvent(
    tx,
    actor,
    asset.id,
    "checked_out",
    {
      holderType: input.holderType,
      holderId: input.holderId,
      holderName: name,
      dueAt: input.dueAt?.toISOString() ?? null,
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
