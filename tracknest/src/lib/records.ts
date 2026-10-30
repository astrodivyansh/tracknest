import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { assetRecordLinks, assetRecords, assets, type RecordKind } from "@/db/schema";
import { CustodyError, recordEvent, type Actor } from "./custody";

export const RECORD_LABEL: Record<RecordKind, { one: string; many: string; reference: string; vendor: string; amount: string; help: string }> = {
  contract: { one: "Contract", many: "Contracts and licences", reference: "Contract no.", vendor: "Supplier", amount: "Value", help: "AMCs, leases, software licences and support agreements." },
  insurance: { one: "Insurance policy", many: "Insurance", reference: "Policy no.", vendor: "Insurer", amount: "Premium", help: "Policies and the assets each one covers." },
  funding: { one: "Funding source", many: "Funding", reference: "Grant / budget no.", vendor: "Funder", amount: "Funds available", help: "Grants and budgets, and how much of each has been spent on assets." },
};

/** Links assets to a record by tag. Unknown tags stop the whole link; ones already linked are skipped. */
export async function linkRecord(tx: Tx, actor: Actor, input: { recordId: string; tags: string[] }) {
  const [record] = await tx.select().from(assetRecords).where(eq(assetRecords.id, input.recordId));
  if (!record) throw new CustodyError("Record not found.");
  const found = input.tags.length
    ? await tx
        .select({ id: assets.id, tag: assets.tag })
        .from(assets)
        .where(and(isNull(assets.deletedAt), inArray(sql`upper(${assets.tag})`, input.tags)))
    : [];
  const unknown = input.tags.filter((t) => !found.some((a) => a.tag.toUpperCase() === t));
  if (unknown.length) throw new CustodyError(`No asset has the tag ${unknown.slice(0, 10).join(", ")}.`);
  let linked = 0;
  for (const a of found) {
    const [row] = await tx
      .insert(assetRecordLinks)
      .values({ orgId: actor.orgId, recordId: record.id, assetId: a.id })
      .onConflictDoNothing()
      .returning({ id: assetRecordLinks.id });
    if (!row) continue;
    linked++;
    await recordEvent(tx, actor, a.id, "record_linked", { kind: record.kind, name: record.name, reference: record.reference });
  }
  return linked;
}

export async function unlinkRecord(tx: Tx, actor: Actor, input: { recordId: string; assetId: string }) {
  const [record] = await tx.select().from(assetRecords).where(eq(assetRecords.id, input.recordId));
  const [gone] = await tx
    .delete(assetRecordLinks)
    .where(and(eq(assetRecordLinks.recordId, input.recordId), eq(assetRecordLinks.assetId, input.assetId)))
    .returning();
  if (!record || !gone) throw new CustodyError("That link no longer exists.");
  await recordEvent(tx, actor, input.assetId, "record_unlinked", { kind: record.kind, name: record.name, reference: record.reference });
}

/** Deletes a record; each linked asset's history notes it, so the past stays readable. */
export async function deleteRecord(tx: Tx, actor: Actor, recordId: string) {
  const links = await tx.select({ assetId: assetRecordLinks.assetId }).from(assetRecordLinks).where(eq(assetRecordLinks.recordId, recordId));
  for (const l of links) await unlinkRecord(tx, actor, { recordId, assetId: l.assetId });
  await tx.delete(assetRecords).where(eq(assetRecords.id, recordId));
}
