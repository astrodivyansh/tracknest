"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOrg } from "@/db";
import { holderSchema } from "@/lib/assets";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { allow } from "@/lib/permissions";
import { fields, handle, optText, type FormState } from "@/lib/form";
import { cancelReservation, reserve } from "@/lib/reservations";

const actorOf = (u: CurrentUser) => ({ id: u.id, name: u.name, orgId: u.orgId });

export async function reserveAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "reserve");
    const input = z
      .object({
        holder: holderSchema,
        startDate: z.iso.date("Pick a start date"),
        endDate: z.iso.date("Pick an end date"),
        notes: optText,
      })
      .parse(fields(form));
    await withOrg(user.orgId, (tx) => reserve(tx, actorOf(user), { assetId, ...input.holder, ...input }));
    revalidatePath("/", "layout");
    return { ok: "Reserved." };
  });
}

export async function cancelReservationAction(reservationId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "reserve");
    const { reason } = z.object({ reason: optText }).parse(fields(form));
    await withOrg(user.orgId, (tx) => cancelReservation(tx, actorOf(user), { reservationId, reason }));
    revalidatePath("/", "layout");
  });
}
