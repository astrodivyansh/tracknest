"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg, type Tx } from "@/db";
import { ASSET_STATUSES, assets, customEvents, customFields, MAINTENANCE_KINDS, organizations } from "@/db/schema";
import { applyFormSetup } from "@/lib/asset-form-setup";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { allow, BULK_ACTION, disposalOn, statusOn } from "@/lib/permissions";
import {
  archiveAsset,
  changeStatus,
  checkIn,
  checkOut,
  CustodyError,
  duplicateAsset,
  extendDue,
  linkAsset,
  lockAsset,
  moveAsset,
  recordEvent,
  unlinkAsset,
} from "@/lib/custody";
import { endOfDayIn } from "@/lib/format";
import { assetSchema, holderSchema, insertAsset, optDate, siteOf } from "@/lib/assets";
import { inputName, parseCustom, showCustom, type CustomValue } from "@/lib/custom-fields";
import { forgetFile, recordFile } from "@/lib/files";
import { BULK, type BulkKind } from "@/lib/labels";
import { scheduleMaintenance } from "@/lib/maintenance";
import { addWarranty, removeWarranty } from "@/lib/warranties";
import { reserve } from "@/lib/reservations";
import { fields, handle, optId, optText, reqText, type FormState } from "@/lib/form";
import { deleteObject, putObject } from "@/lib/storage";

const actorOf = (u: CurrentUser) => ({ id: u.id, name: u.name, orgId: u.orgId });

const formSetup = async (tx: Tx, orgId: string) =>
  (await tx.select({ s: organizations.assetForm }).from(organizations).where(eq(organizations.id, orgId)))[0].s;

/** Reads and validates the custom field inputs for an asset in `categoryId`. */
async function customFrom(tx: Tx, form: FormData, categoryId: string | null) {
  const defs = await tx.select().from(customFields);
  const raw = Object.fromEntries(
    defs.map((d) => [d.id, d.type === "multiselect" ? form.getAll(inputName(d)).join("\n") : form.get(inputName(d))?.toString()]),
  );
  const { values, errors } = parseCustom(defs, raw, categoryId);
  if (errors.length) throw new CustodyError(errors.join(" "));
  return { defs, values };
}


export async function createAsset(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "add");
    const input = assetSchema.parse(fields(form));
    const id = await withOrg(user.orgId, async (tx) => {
      const applied = applyFormSetup(input, await formSetup(tx, user.orgId));
      const { values: custom } = await customFrom(tx, form, applied.categoryId);
      return (await insertAsset(tx, actorOf(user), { ...applied, custom })).id;
    });
    redirect(`/assets/${id}`);
  });
}

export async function updateAsset(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "edit");
    const submitted = assetSchema.parse(fields(form));
    await withOrg(user.orgId, async (tx) => {
      const [before] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
        .for("update");
      if (!before) throw new CustodyError("Asset not found.");
      const input = applyFormSetup(submitted, await formSetup(tx, user.orgId), before);
      const next = { ...input, tag: input.tag ?? before.tag, siteId: await siteOf(tx, input.locationId) };
      const changes = Object.fromEntries(
        Object.entries(next)
          .filter(([k, v]) => (before[k as keyof typeof before] ?? null) !== v)
          .map(([k, v]) => [k, { from: before[k as keyof typeof before] ?? null, to: v }]),
      );
      // Custom fields: record each change under its label; keep values of fields that were deleted.
      const { defs, values } = await customFrom(tx, form, input.categoryId);
      const old = before.custom as Record<string, CustomValue>;
      const custom = { ...Object.fromEntries(Object.entries(old).filter(([k]) => !defs.some((d) => d.id === k))), ...values };
      for (const d of defs) {
        const [from, to] = [showCustom(d, old[d.id]), showCustom(d, custom[d.id])]; // strings, so lists compare by value
        if (from !== to) changes[d.label] = { from, to };
      }
      if (Object.keys(changes).length === 0) return;
      await tx.update(assets).set({ ...next, custom, updatedAt: new Date() }).where(eq(assets.id, assetId));
      await recordEvent(tx, actorOf(user), assetId, "edited", { changes });
    });
    redirect(`/assets/${assetId}`);
  });
}


/** Checks out every asset in the form's repeated "assetId" field (e.g. a laptop plus its pendrive) to one holder, all or none. */
export async function checkOutAction(state: FormState, form: FormData): Promise<FormState> {
  return bulkAction("checkout", form.getAll("assetId").map(String), state, form);
}

export async function checkInAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "checkout");
    const input = z.object({ returnLocationId: optId, condition: optText, notes: optText }).parse(fields(form));
    await withOrg(user.orgId, (tx) => checkIn(tx, actorOf(user), { assetId, ...input }));
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Checked in." };
  });
}

export async function extendDueAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "checkout");
    const { dueDate } = z.object({ dueDate: z.iso.date("Pick a new due date") }).parse(fields(form));
    await withOrg(user.orgId, (tx) =>
      extendDue(tx, actorOf(user), { assetId, dueAt: endOfDayIn(dueDate, user.timezone) }),
    );
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Due date updated." };
  });
}

export async function changeStatusAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "dispose");
    const input = z.object({ to: z.enum(ASSET_STATUSES, "Choose an action"), reason: optText }).parse(fields(form));
    if (!statusOn(user, input.to)) throw new CustodyError("That event is turned off for your organization.");
    await withOrg(user.orgId, (tx) => changeStatus(tx, actorOf(user), { assetId, ...input }));
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Status updated." };
  });
}

export async function archiveAssetAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const { reason } = z.object({ reason: reqText("Reason") }).parse(fields(form));
    await withOrg(user.orgId, (tx) => archiveAsset(tx, actorOf(user), { assetId, reason }));
    redirect("/assets");
  });
}

export async function uploadFilesAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "edit");
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new CustodyError("Choose at least one file.");
    const uploads = await Promise.all(files.map(async (f) => ({ filename: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    // All or nothing: if any file is refused, remove the ones already written.
    const written: string[] = [];
    try {
      await withOrg(user.orgId, async (tx) => {
        for (const u of uploads) {
          const file = await recordFile(tx, actorOf(user), { assetId, ...u });
          await putObject(file.storageKey, u.bytes);
          written.push(file.storageKey);
        }
      });
    } catch (e) {
      await Promise.all(written.map(deleteObject));
      throw e;
    }
    revalidatePath(`/assets/${assetId}`);
    return { ok: `Uploaded ${files.length} file${files.length === 1 ? "" : "s"}.` };
  });
}

export async function removeFileAction(assetId: string, fileId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "edit");
    const key = await withOrg(user.orgId, (tx) => forgetFile(tx, actorOf(user), { assetId, fileId }));
    await deleteObject(key); // after commit, so a failed transaction never loses the file
    revalidatePath(`/assets/${assetId}`);
  });
}

export async function disposeAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "dispose");
    const input = z
      .object({
        method: z.enum(["sold", "scrapped", "donated", "written_off"], "Choose how it was disposed of"),
        on: z.iso.date("Pick the disposal date"),
        value: assetSchema.shape.cost,
        reason: reqText("Reason"),
      })
      .parse(fields(form));
    if (!disposalOn(user, input.method)) throw new CustodyError("That way of disposing is turned off for your organization.");
    await withOrg(user.orgId, (tx) =>
      changeStatus(tx, actorOf(user), {
        assetId,
        to: "disposed",
        reason: input.reason,
        disposal: { on: input.on, method: input.method, value: input.value },
      }),
    );
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Asset disposed." };
  });
}

const moveSchema = z.object({ locationId: optId, departmentId: optId }).refine((v) => v.locationId || v.departmentId, "Choose a location or department");

export async function moveAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "move");
    const input = moveSchema.parse(fields(form));
    const moved = await withOrg(user.orgId, (tx) => moveAsset(tx, actorOf(user), { assetId, ...input }));
    if (!moved) throw new CustodyError("It's already there.");
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Moved." };
  });
}

export async function linkAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "link");
    const { parentTag } = z.object({ parentTag: reqText("Parent asset tag") }).parse(fields(form));
    await withOrg(user.orgId, (tx) => linkAsset(tx, actorOf(user), { childId: assetId, parentTag }));
    revalidatePath("/assets", "layout");
    return { ok: "Linked." };
  });
}

export async function unlinkAction(assetId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "link");
    await withOrg(user.orgId, (tx) => unlinkAsset(tx, actorOf(user), { childId: assetId }));
    revalidatePath("/assets", "layout");
  });
}

export async function duplicateAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "add");
    const { copies } = z.object({ copies: z.coerce.number("Enter how many copies").int().min(1).max(50, "At most 50 copies at a time") }).parse(fields(form));
    const rows = await withOrg(user.orgId, (tx) => duplicateAsset(tx, actorOf(user), { assetId, copies }));
    if (rows.length === 1) redirect(`/assets/${rows[0].id}`);
    revalidatePath("/assets");
    return { ok: `Created ${rows.map((r) => r.tag).join(", ")}.` };
  });
}

/** Runs one action on many assets in one transaction: all succeed, or none do. */
export async function bulkAction(kind: BulkKind, assetIds: string[], _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), BULK_ACTION[kind]);
    const actor = actorOf(user);
    const ids = z.array(z.uuid()).min(1, "Select at least one asset").max(200, "At most 200 assets at a time").parse(assetIds);
    const f = fields(form);
    const run: (tx: Tx, assetId: string) => Promise<unknown> = (() => {
      switch (kind) {
        case "checkout": {
          const i = z.object({ holder: holderSchema, dueDate: optDate, condition: optText, notes: optText }).parse(f);
          if (i.holder.holderType === "customer") allow(user, "lease");
          const dueAt = i.dueDate ? endOfDayIn(i.dueDate, user.timezone) : null;
          return (tx, assetId) => checkOut(tx, actor, { assetId, ...i.holder, dueAt, condition: i.condition, notes: i.notes });
        }
        case "checkin": {
          const i = z.object({ returnLocationId: optId, condition: optText, notes: optText }).parse(f);
          return (tx, assetId) => checkIn(tx, actor, { assetId, ...i });
        }
        case "move": {
          const i = moveSchema.parse(f);
          return (tx, assetId) => moveAsset(tx, actor, { assetId, ...i });
        }
        case "maintenance": {
          const i = z.object({ title: reqText("What needs doing"), kind: z.enum(MAINTENANCE_KINDS), dueDate: optDate, vendor: optText, notes: optText }).parse(f);
          return (tx, assetId) => scheduleMaintenance(tx, actor, { assetId, ...i });
        }
        case "reserve": {
          const i = z.object({ holder: holderSchema, startDate: z.iso.date("Pick a start date"), endDate: z.iso.date("Pick an end date"), notes: optText }).parse(f);
          return (tx, assetId) => reserve(tx, actor, { assetId, ...i.holder, startDate: i.startDate, endDate: i.endDate, notes: i.notes });
        }
        case "dispose": {
          const i = z
            .object({ method: z.enum(["sold", "scrapped", "donated", "written_off"], "Choose how they were disposed of"), on: z.iso.date("Pick the disposal date"), reason: reqText("Reason") })
            .parse(f);
          if (!disposalOn(user, i.method)) throw new CustodyError("That way of disposing is turned off for your organization.");
          return (tx, assetId) => changeStatus(tx, actor, { assetId, to: "disposed", reason: i.reason, disposal: { on: i.on, method: i.method } });
        }
        default:
          throw new CustodyError("Unknown action.");
      }
    })();
    await withOrg(user.orgId, async (tx) => {
      for (const id of ids) await run(tx, id);
    });
    revalidatePath("/", "layout");
    return { ok: `${BULK[kind]}: done for ${ids.length} asset${ids.length === 1 ? "" : "s"}.` };
  });
}

export async function addWarrantyAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "warranty");
    const input = z
      .object({
        provider: optText,
        expiresOn: optDate,
        lengthMonths: z.coerce.number("Length must be a number of months").int().min(1).max(600).optional().or(z.literal("").transform(() => undefined)),
        notes: optText,
      })
      .parse(fields(form));
    await withOrg(user.orgId, (tx) => addWarranty(tx, actorOf(user), { assetId, ...input }));
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Warranty added." };
  });
}

export async function removeWarrantyAction(assetId: string, warrantyId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "warranty");
    await withOrg(user.orgId, (tx) => removeWarranty(tx, actorOf(user), { assetId, warrantyId }));
    revalidatePath(`/assets/${assetId}`);
  });
}

export async function recordCustomEventAction(assetId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "edit");
    const input = z
      .object({ eventId: z.uuid("Choose an event"), on: z.iso.date("Pick the date"), notes: optText })
      .parse(fields(form));
    await withOrg(user.orgId, async (tx) => {
      const [ev] = await tx.select({ name: customEvents.name }).from(customEvents).where(eq(customEvents.id, input.eventId));
      if (!ev) throw new CustodyError("That event doesn't exist.");
      const asset = await lockAsset(tx, assetId);
      await recordEvent(tx, actorOf(user), asset.id, "custom", { name: ev.name, on: input.on, notes: input.notes });
    });
    revalidatePath(`/assets/${assetId}`);
    return { ok: "Recorded." };
  });
}
