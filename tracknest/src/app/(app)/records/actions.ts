"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assetRecords, type RecordKind } from "@/db/schema";
import { assetSchema, optDate } from "@/lib/assets";
import { parseTags } from "@/lib/audits";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { fields, handle, optText, reqText, type FormState } from "@/lib/form";
import { allow } from "@/lib/permissions";
import { deleteRecord, linkRecord, unlinkRecord } from "@/lib/records";

const actorOf = (u: CurrentUser) => ({ id: u.id, name: u.name, orgId: u.orgId });
const schema = z
  .object({
    name: reqText("Name"),
    reference: optText,
    vendor: optText,
    startDate: optDate,
    endDate: optDate,
    amount: assetSchema.shape.cost,
    notes: optText,
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, "The end date is before the start date.");

export async function addRecord(kind: RecordKind, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    const input = schema.parse(fields(form));
    const [r] = await withOrg(user.orgId, (tx) => tx.insert(assetRecords).values({ orgId: user.orgId, kind, ...input, createdBy: user.name }).returning());
    redirect(`/records/${kind}/${r.id}`);
  });
}

export async function updateRecord(id: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    const input = schema.parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.update(assetRecords).set(input).where(eq(assetRecords.id, id)));
    revalidatePath("/records", "layout");
    return { ok: "Saved." };
  });
}

export async function removeRecord(kind: RecordKind, id: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    await withOrg(user.orgId, (tx) => deleteRecord(tx, actorOf(user), id));
    redirect(`/records/${kind}`);
  });
}

export async function linkAssets(id: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    const tags = parseTags(String(form.get("tags") ?? ""));
    if (tags.length === 0) throw new CustodyError("Enter at least one asset tag.");
    const n = await withOrg(user.orgId, (tx) => linkRecord(tx, actorOf(user), { recordId: id, tags }));
    revalidatePath("/records", "layout");
    return { ok: `Linked ${n} asset${n === 1 ? "" : "s"}.` };
  });
}

export async function unlinkAsset(id: string, assetId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    await withOrg(user.orgId, (tx) => unlinkRecord(tx, actorOf(user), { recordId: id, assetId }));
    revalidatePath("/records", "layout");
  });
}
