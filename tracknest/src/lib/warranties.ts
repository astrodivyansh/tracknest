import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { warranties } from "@/db/schema";
import { CustodyError, lockAsset, recordEvent, type Actor } from "./custody";
import { addMonths } from "./maintenance";

/** Adds a warranty. Without an end date, it's `lengthMonths` from the purchase date. */
export async function addWarranty(
  tx: Tx,
  actor: Actor,
  input: { assetId: string; provider?: string | null; expiresOn?: string | null; lengthMonths?: number | null; notes?: string | null },
) {
  const asset = await lockAsset(tx, input.assetId);
  let expiresOn = input.expiresOn ?? null;
  if (!expiresOn && input.lengthMonths) {
    if (!asset.purchaseDate) throw new CustodyError("Enter the end date, or add a purchase date to the asset first.");
    expiresOn = addMonths(asset.purchaseDate, input.lengthMonths);
  }
  if (!expiresOn) throw new CustodyError("Enter the warranty end date or its length in months.");
  const [w] = await tx
    .insert(warranties)
    .values({
      orgId: actor.orgId,
      assetId: asset.id,
      provider: input.provider || null,
      expiresOn,
      lengthMonths: input.lengthMonths || null,
      notes: input.notes || null,
      createdBy: actor.name,
    })
    .returning();
  await recordEvent(tx, actor, asset.id, "warranty_added", { warrantyId: w.id, provider: w.provider, expiresOn: w.expiresOn, notes: w.notes });
  return w;
}

export async function removeWarranty(tx: Tx, actor: Actor, input: { assetId: string; warrantyId: string }) {
  const [w] = await tx
    .delete(warranties)
    .where(and(eq(warranties.id, input.warrantyId), eq(warranties.assetId, input.assetId)))
    .returning();
  if (!w) throw new CustodyError("Warranty not found.");
  await recordEvent(tx, actor, w.assetId, "warranty_removed", { provider: w.provider, expiresOn: w.expiresOn });
}
