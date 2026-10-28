"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg, type Tx } from "@/db";
import { assets, HOLDER_TYPES, locations } from "@/db/schema";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { checkIn, checkOut, CustodyError, extendDue, nextTag, recordEvent } from "@/lib/custody";
import { endOfDayIn } from "@/lib/format";
import { fields, handle, optId, optText, reqText, type FormState } from "@/lib/form";

const optDate = z
  .union([z.literal(""), z.iso.date("Enter a valid date")])
  .optional()
  .transform((v) => v || null);

const assetSchema = z.object({
  tag: optText,
  name: reqText("Asset name"),
  categoryId: optId,
  brand: optText,
  model: optText,
  serial: optText,
  purchaseDate: optDate,
  cost: z
    .union([z.literal(""), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Cost must be a number like 1250.50")])
    .optional()
    .transform((v) => (v ? Number(v).toFixed(2) : null)), // matches numeric(12,2) so edits diff cleanly
  locationId: optId,
  departmentId: optId,
  condition: optText,
  notes: optText,
});

const actorOf = (u: CurrentUser) => ({ id: u.id, name: u.name, orgId: u.orgId });

async function siteOf(tx: Tx, locationId: string | null) {
  if (!locationId) return null;
  const [loc] = await tx.select({ siteId: locations.siteId }).from(locations).where(eq(locations.id, locationId));
  if (!loc) throw new CustodyError("That location doesn't exist.");
  return loc.siteId;
}

export async function createAsset(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    const input = assetSchema.parse(fields(form));
    const id = await withOrg(user.orgId, async (tx) => {
      const [asset] = await tx
        .insert(assets)
        .values({
          ...input,
          orgId: user.orgId,
          tag: input.tag ?? (await nextTag(tx, user.orgId)),
          siteId: await siteOf(tx, input.locationId),
        })
        .returning({ id: assets.id, tag: assets.tag });
      await recordEvent(tx, actorOf(user), asset.id, "created", { tag: asset.tag, name: input.name });
      return asset.id;
    });
    redirect(`/assets/${id}`);
  });
}

export async function updateAsset(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    const input = assetSchema.parse(fields(form));
    await withOrg(user.orgId, async (tx) => {
      const [before] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
        .for("update");
      if (!before) throw new CustodyError("Asset not found.");
      const next = { ...input, tag: input.tag ?? before.tag, siteId: await siteOf(tx, input.locationId) };
      const changes = Object.fromEntries(
        Object.entries(next)
          .filter(([k, v]) => (before[k as keyof typeof before] ?? null) !== v)
          .map(([k, v]) => [k, { from: before[k as keyof typeof before] ?? null, to: v }]),
      );
      if (Object.keys(changes).length === 0) return;
      await tx.update(assets).set({ ...next, updatedAt: new Date() }).where(eq(assets.id, assetId));
      await recordEvent(tx, actorOf(user), assetId, "edited", { changes });
    });
    redirect(`/assets/${assetId}`);
  });
}

const holderSchema = z
  .string()
  .regex(/^(person|location|department):[0-9a-f-]{36}$/, "Choose who or where to check out to")
  .transform((v) => {
    const [type, id] = v.split(":");
    return { holderType: type as (typeof HOLDER_TYPES)[number], holderId: id };
  });

export async function checkOutAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    const input = z
      .object({ holder: holderSchema, dueDate: optDate, condition: optText, notes: optText })
      .parse(fields(form));
    await withOrg(user.orgId, (tx) =>
      checkOut(tx, actorOf(user), {
        assetId,
        ...input.holder,
        dueAt: input.dueDate ? endOfDayIn(input.dueDate, user.timezone) : null,
        condition: input.condition,
        notes: input.notes,
      }),
    );
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Checked out." };
  });
}

export async function checkInAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    const input = z.object({ returnLocationId: optId, condition: optText, notes: optText }).parse(fields(form));
    await withOrg(user.orgId, (tx) => checkIn(tx, actorOf(user), { assetId, ...input }));
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Checked in." };
  });
}

export async function extendDueAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    const { dueDate } = z.object({ dueDate: z.iso.date("Pick a new due date") }).parse(fields(form));
    await withOrg(user.orgId, (tx) =>
      extendDue(tx, actorOf(user), { assetId, dueAt: endOfDayIn(dueDate, user.timezone) }),
    );
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Due date updated." };
  });
}
