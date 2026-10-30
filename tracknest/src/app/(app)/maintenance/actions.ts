"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOrg } from "@/db";
import { MAINTENANCE_KINDS } from "@/db/schema";
import { optDate } from "@/lib/assets";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { allow } from "@/lib/permissions";
import { fields, handle, optText, reqText, type FormState } from "@/lib/form";
import { cancelMaintenance, completeMaintenance, scheduleMaintenance, startMaintenance } from "@/lib/maintenance";

const actorOf = (u: CurrentUser) => ({ id: u.id, name: u.name, orgId: u.orgId });
const optCost = z
  .union([z.literal(""), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Cost must be a number like 1250.50")])
  .optional()
  .transform((v) => (v ? Number(v).toFixed(2) : null));

// Asset, dashboard and maintenance pages all show jobs.
const refresh = () => revalidatePath("/", "layout");

export async function scheduleAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "maintenance");
    const input = z
      .object({
        title: reqText("What needs doing"),
        kind: z.enum(MAINTENANCE_KINDS),
        dueDate: optDate,
        repeatMonths: z.coerce.number().int().min(0).max(60).optional().transform((v) => v || null),
        vendor: optText,
        notes: optText,
        startNow: z.literal("on").optional(),
      })
      .parse(fields(form));
    await withOrg(user.orgId, async (tx) => {
      const job = await scheduleMaintenance(tx, actorOf(user), { assetId, ...input });
      if (input.startNow) await startMaintenance(tx, actorOf(user), job.id);
    });
    refresh();
    return { ok: input.startNow ? "Maintenance started." : "Maintenance scheduled." };
  });
}

export async function startAction(maintenanceId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "maintenance");
    await withOrg(user.orgId, (tx) => startMaintenance(tx, actorOf(user), maintenanceId));
    refresh();
  });
}

export async function completeAction(maintenanceId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "maintenance");
    const input = z
      .object({ cost: optCost, notes: optText, result: z.enum(["available", "broken"]).optional() })
      .parse(fields(form));
    await withOrg(user.orgId, (tx) => completeMaintenance(tx, actorOf(user), { maintenanceId, ...input }));
    refresh();
  });
}

export async function cancelAction(maintenanceId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "maintenance");
    const { reason } = z.object({ reason: optText }).parse(fields(form));
    await withOrg(user.orgId, (tx) => cancelMaintenance(tx, actorOf(user), { maintenanceId, reason }));
    refresh();
  });
}
