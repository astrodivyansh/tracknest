import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { assets, maintenance, MAINTENANCE_KINDS } from "@/db/schema";
import { CustodyError, lockAsset, recordEvent, STATUS_LABEL, todayIn, type Actor } from "./custody";

type Kind = (typeof MAINTENANCE_KINDS)[number];

export { todayIn };

/** Columns for job lists (see components/maintenance-list.tsx). */
export const jobFields = (tz: string) => ({
  id: maintenance.id,
  title: maintenance.title,
  kind: maintenance.kind,
  state: maintenance.state,
  dueDate: maintenance.dueDate,
  repeatMonths: maintenance.repeatMonths,
  vendor: maintenance.vendor,
  cost: maintenance.cost,
  completionNotes: maintenance.completionNotes,
  closedAt: maintenance.closedAt,
  overdue: sql<boolean>`coalesce(${maintenance.state} = 'scheduled' and ${maintenance.dueDate} < ${todayIn(tz)}, false)`,
});

/** "2026-01-31" + 1 month → "2026-02-28" (clamped to the month's last day). */
export function addMonths(day: string, months: number) {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

async function lockJob(tx: Tx, id: string) {
  const [job] = await tx.select().from(maintenance).where(eq(maintenance.id, id)).for("update");
  if (!job) throw new CustodyError("Maintenance job not found.");
  return job;
}

export async function scheduleMaintenance(
  tx: Tx,
  actor: Actor,
  input: {
    assetId: string;
    title: string;
    kind: Kind;
    dueDate?: string | null;
    repeatMonths?: number | null;
    vendor?: string | null;
    notes?: string | null;
  },
) {
  const asset = await lockAsset(tx, input.assetId);
  if (asset.status === "disposed") throw new CustodyError(`${asset.tag} is disposed.`);
  if (input.repeatMonths && !input.dueDate) throw new CustodyError("A repeating schedule needs a due date to count from.");
  const [job] = await tx
    .insert(maintenance)
    .values({
      orgId: actor.orgId,
      assetId: asset.id,
      title: input.title,
      kind: input.kind,
      dueDate: input.dueDate || null,
      repeatMonths: input.repeatMonths || null,
      vendor: input.vendor || null,
      notes: input.notes || null,
      createdBy: actor.name,
    })
    .returning();
  await recordEvent(tx, actor, asset.id, "maintenance_scheduled", {
    maintenanceId: job.id,
    title: job.title,
    kind: job.kind,
    dueDate: job.dueDate,
    repeatMonths: job.repeatMonths,
    vendor: job.vendor,
  });
  return job;
}

/** The asset goes to "under maintenance" until the job is completed. */
export async function startMaintenance(tx: Tx, actor: Actor, maintenanceId: string) {
  const job = await lockJob(tx, maintenanceId);
  if (job.state !== "scheduled") throw new CustodyError("Only a scheduled job can be started.");
  const asset = await lockAsset(tx, job.assetId);
  if (asset.status === "checked_out") throw new CustodyError(`${asset.tag} is checked out. Check it in first.`);
  if (asset.status !== "available" && asset.status !== "broken") {
    throw new CustodyError(`${asset.tag} is ${STATUS_LABEL[asset.status].toLowerCase()}, so it can't go for maintenance.`);
  }
  await tx.update(maintenance).set({ state: "in_progress", startedAt: new Date() }).where(eq(maintenance.id, job.id));
  await tx.update(assets).set({ status: "under_maintenance", updatedAt: new Date() }).where(eq(assets.id, asset.id));
  await recordEvent(tx, actor, asset.id, "maintenance_started", {
    maintenanceId: job.id,
    title: job.title,
    vendor: job.vendor,
    from: asset.status,
  });
}

/**
 * Closes a job. For a job in progress the asset returns as `result` (working → available,
 * or still broken). A scheduled job done on the spot (e.g. a quick inspection) leaves status alone.
 * Repeating jobs schedule their next occurrence.
 */
export async function completeMaintenance(
  tx: Tx,
  actor: Actor,
  input: { maintenanceId: string; cost?: string | null; notes?: string | null; result?: "available" | "broken" },
) {
  const job = await lockJob(tx, input.maintenanceId);
  if (job.state !== "scheduled" && job.state !== "in_progress") throw new CustodyError("This job is already closed.");
  const asset = await lockAsset(tx, job.assetId);
  const result = job.state === "in_progress" ? (input.result ?? "available") : asset.status;

  await tx
    .update(maintenance)
    .set({
      state: "completed",
      cost: input.cost || null,
      completionNotes: input.notes || null,
      closedAt: new Date(),
      closedBy: actor.name,
    })
    .where(eq(maintenance.id, job.id));
  if (job.state === "in_progress") {
    await tx.update(assets).set({ status: result, updatedAt: new Date() }).where(eq(assets.id, asset.id));
  }
  await recordEvent(tx, actor, asset.id, "maintenance_completed", {
    maintenanceId: job.id,
    title: job.title,
    cost: input.cost || null,
    notes: input.notes || null,
    assetStatus: result,
  });

  if (job.repeatMonths && job.dueDate) {
    await scheduleMaintenance(tx, actor, {
      assetId: asset.id,
      title: job.title,
      kind: job.kind,
      dueDate: addMonths(job.dueDate, job.repeatMonths),
      repeatMonths: job.repeatMonths,
      vendor: job.vendor,
      notes: job.notes,
    });
  }
}

/** Only scheduled jobs can be cancelled; one in progress must be completed with its outcome. */
export async function cancelMaintenance(tx: Tx, actor: Actor, input: { maintenanceId: string; reason?: string | null }) {
  const job = await lockJob(tx, input.maintenanceId);
  if (job.state !== "scheduled") throw new CustodyError("Only a scheduled job can be cancelled. Complete a job in progress instead.");
  await tx
    .update(maintenance)
    .set({ state: "cancelled", completionNotes: input.reason || null, closedAt: new Date(), closedBy: actor.name })
    .where(eq(maintenance.id, job.id));
  await recordEvent(tx, actor, job.assetId, "maintenance_cancelled", {
    maintenanceId: job.id,
    title: job.title,
    reason: input.reason || null,
  });
}
