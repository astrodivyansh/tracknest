import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { checkouts, reservations, type HolderType } from "@/db/schema";
import { CustodyError, holderName, lockAsset, orgClock, recordEvent, STATUS_LABEL, type Actor } from "./custody";
import { fmtDate } from "./format";

const day = (d: string) => fmtDate(d, "UTC"); // plain calendar dates

/** Books an asset for [startDate, endDate] (inclusive, org calendar days). */
export async function reserve(
  tx: Tx,
  actor: Actor,
  input: { assetId: string; holderType: HolderType; holderId: string; startDate: string; endDate: string; notes?: string | null },
) {
  const asset = await lockAsset(tx, input.assetId); // serialises bookings of one asset
  if (asset.status === "disposed" || asset.status === "lost") {
    throw new CustodyError(`${asset.tag} is ${STATUS_LABEL[asset.status].toLowerCase()}, so it can't be reserved.`);
  }
  if (input.endDate < input.startDate) throw new CustodyError("The end date is before the start date.");
  const { tz, today } = await orgClock(tx, actor.orgId);
  if (input.startDate < today) throw new CustodyError("The start date is in the past.");

  if (asset.status === "checked_out") {
    const [co] = await tx
      .select({ holderName: checkouts.holderName, dueDay: sql<string | null>`(${checkouts.dueAt} at time zone ${tz})::date::text` })
      .from(checkouts)
      .where(and(eq(checkouts.assetId, asset.id), eq(checkouts.state, "open")));
    if (co && (!co.dueDay || co.dueDay >= input.startDate)) {
      throw new CustodyError(
        `${asset.tag} is checked out to ${co.holderName}${co.dueDay ? ` until ${day(co.dueDay)}` : " with no due date"}. Pick dates after it's due back.`,
      );
    }
  }

  // The exclusion constraint also refuses overlaps; checking first gives a readable message.
  const [clash] = await tx
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.assetId, asset.id),
        eq(reservations.state, "active"),
        lte(reservations.startDate, input.endDate),
        gte(reservations.endDate, input.startDate),
      ),
    );
  if (clash) {
    throw new CustodyError(`${asset.tag} is already reserved for ${clash.holderName} from ${day(clash.startDate)} to ${day(clash.endDate)}.`);
  }

  const name = await holderName(tx, input.holderType, input.holderId);
  const [r] = await tx
    .insert(reservations)
    .values({ ...input, orgId: actor.orgId, holderName: name, notes: input.notes || null, createdBy: actor.name })
    .returning();
  await recordEvent(tx, actor, asset.id, "reserved", {
    reservationId: r.id,
    holderName: name,
    startDate: r.startDate,
    endDate: r.endDate,
    notes: r.notes,
  });
  return r;
}

export async function cancelReservation(tx: Tx, actor: Actor, input: { reservationId: string; reason?: string | null }) {
  const [r] = await tx.select().from(reservations).where(eq(reservations.id, input.reservationId)).for("update");
  if (!r) throw new CustodyError("Reservation not found.");
  if (r.state !== "active") throw new CustodyError("This reservation is no longer active.");
  await tx.update(reservations).set({ state: "cancelled" }).where(eq(reservations.id, r.id));
  await recordEvent(tx, actor, r.assetId, "reservation_cancelled", {
    reservationId: r.id,
    holderName: r.holderName,
    startDate: r.startDate,
    endDate: r.endDate,
    reason: input.reason || null,
  });
}
