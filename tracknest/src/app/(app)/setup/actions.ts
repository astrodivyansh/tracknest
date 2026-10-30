"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { categories, customFields, DEP_METHODS, departments, FIELD_TYPES, locations, sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { HAS_OPTIONS } from "@/lib/custom-fields";
import { DEP_LABEL, NEEDS_LIFE } from "@/lib/depreciation";
import { fields, handle, optId, optText, reqText, type FormState } from "@/lib/form";

export async function addSite(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z.object({ name: reqText("Site name"), address: optText }).parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(sites).values({ orgId: user.orgId, ...input }));
    revalidatePath("/setup");
    return { ok: `Site “${input.name}” added.` };
  });
}

export async function addLocation(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z.object({ name: reqText("Location name"), siteId: z.uuid("Pick a site") }).parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(locations).values({ orgId: user.orgId, ...input }));
    revalidatePath("/setup");
    return { ok: `Location “${input.name}” added.` };
  });
}

export async function addCategory(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z.object({ name: reqText("Category name"), parentId: optId }).parse(fields(form));
    await withOrg(user.orgId, async (tx) => {
      if (input.parentId) {
        const [parent] = await tx.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, input.parentId));
        if (!parent) throw new CustodyError("That parent category doesn't exist.");
        if (parent.parentId) throw new CustodyError("Sub-categories can't have their own sub-categories.");
      }
      await tx.insert(categories).values({ orgId: user.orgId, ...input });
    });
    revalidatePath("/setup");
    return { ok: `Category “${input.name}” added.` };
  });
}

export async function addDepartment(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z.object({ name: reqText("Department name") }).parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(departments).values({ orgId: user.orgId, ...input }));
    revalidatePath("/setup");
    return { ok: `Department “${input.name}” added.` };
  });
}

const TABLES = { site: sites, location: locations, category: categories, department: departments };
export type SetupKind = keyof typeof TABLES;

// Past check-outs keep the holder name they were made with, so renaming never rewrites history.
export async function renameItem(kind: SetupKind, id: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const { name } = z.object({ name: reqText("Name") }).parse(fields(form));
    const t = TABLES[kind];
    const [row] = await withOrg(user.orgId, (tx) => tx.update(t).set({ name }).where(eq(t.id, id)).returning({ id: t.id }));
    if (!row) throw new CustodyError("Not found.");
    revalidatePath("/setup");
    return { ok: "Renamed." };
  });
}

/** Only unused items can go; foreign keys refuse anything still referenced (see handle()). */
export async function removeItem(kind: SetupKind, id: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const t = TABLES[kind];
    await withOrg(user.orgId, (tx) => tx.delete(t).where(eq(t.id, id)));
    revalidatePath("/setup");
  });
}

const pct = z
  .union([z.literal(""), z.coerce.number().min(0, "Percent can't be negative").max(99.99, "Percent must be below 100")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v.toFixed(2)));

export async function setDepreciationRule(categoryId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z
      .object({
        depMethod: z.enum(DEP_METHODS),
        depLifeYears: z
          .union([z.literal(""), z.coerce.number().gt(0, "Useful life must be more than 0").max(100)])
          .optional()
          .transform((v) => (v === "" || v === undefined ? null : v.toFixed(2))),
        depRatePct: pct,
        depSalvagePct: pct,
      })
      .parse(fields(form));
    const needsLife = NEEDS_LIFE.includes(input.depMethod);
    if (needsLife && !input.depLifeYears) throw new CustodyError(`${DEP_LABEL[input.depMethod]} needs a useful life in years.`);
    if (input.depMethod === "double_declining" && Number(input.depLifeYears) < 2) throw new CustodyError("Double declining needs a useful life of at least 2 years.");
    if (input.depMethod === "sum_of_years" && !Number.isInteger(Number(input.depLifeYears))) throw new CustodyError("Sum of the years' digits needs a whole number of years.");
    if (input.depMethod === "declining" && !Number(input.depRatePct)) throw new CustodyError("Declining balance needs a yearly rate.");
    const rule =
      input.depMethod === "none"
        ? { depMethod: "none" as const, depLifeYears: null, depRatePct: null, depSalvagePct: null }
        : {
            ...input,
            depLifeYears: needsLife ? input.depLifeYears : null,
            depRatePct: input.depMethod === "declining" ? input.depRatePct : null,
          };
    await withOrg(user.orgId, (tx) => tx.update(categories).set(rule).where(eq(categories.id, categoryId)));
    revalidatePath("/setup");
    return { ok: "Rule saved." };
  });
}

export async function addCustomField(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z
      .object({
        label: reqText("Field name").pipe(z.string().max(60, "Keep the name under 60 characters")),
        type: z.enum(FIELD_TYPES, "Choose a type"),
        options: optText,
        required: z.literal("on").optional(),
        categoryId: optId,
        remindDays: z
          .union([z.literal(""), z.coerce.number().int("Whole days only").min(0).max(365, "At most 365 days")])
          .optional()
          .transform((v) => (v === "" || v === undefined ? null : v)),
      })
      .parse(fields(form));
    const options = [...new Set((input.options ?? "").split(/[,\n]/).map((o) => o.trim()).filter(Boolean))];
    if (HAS_OPTIONS.includes(input.type) && options.length < 2) throw new CustodyError("A dropdown or multiple choice needs at least two options, separated by commas.");
    await withOrg(user.orgId, (tx) =>
      tx.insert(customFields).values({
        orgId: user.orgId,
        label: input.label,
        type: input.type,
        options: HAS_OPTIONS.includes(input.type) ? options : [],
        required: input.type !== "checkbox" && input.required === "on",
        categoryId: input.categoryId,
        remindDays: input.type === "date" ? input.remindDays : null,
      }),
    );
    revalidatePath("/setup");
    return { ok: `Field “${input.label}” added.` };
  });
}

/** Removes the definition only; values already saved stay in assets.custom and in history. */
export async function removeCustomField(fieldId: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    await withOrg(user.orgId, (tx) => tx.delete(customFields).where(eq(customFields.id, fieldId)));
    revalidatePath("/setup");
  });
}

export async function setFieldReminder(fieldId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const { remindDays } = z
      .object({
        remindDays: z
          .union([z.literal(""), z.coerce.number().int("Whole days only").min(0).max(365, "At most 365 days")])
          .transform((v) => (v === "" ? null : v)),
      })
      .parse(fields(form));
    await withOrg(user.orgId, (tx) =>
      tx.update(customFields).set({ remindDays }).where(and(eq(customFields.id, fieldId), eq(customFields.type, "date"))),
    );
    revalidatePath("/setup");
    return { ok: remindDays === null ? "Reminder off." : `Reminder set to ${remindDays} days before.` };
  });
}

/** Rename a field or change its dropdown options. Saved values are keyed by field id, so they survive a rename. */
export async function updateCustomField(fieldId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z
      .object({ label: reqText("Field name").pipe(z.string().max(60, "Keep the name under 60 characters")), options: optText })
      .parse(fields(form));
    const options = [...new Set((input.options ?? "").split(/[,\n]/).map((o) => o.trim()).filter(Boolean))];
    await withOrg(user.orgId, async (tx) => {
      const [f] = await tx.select().from(customFields).where(eq(customFields.id, fieldId));
      if (!f) throw new CustodyError("Field not found.");
      if (HAS_OPTIONS.includes(f.type) && options.length < 2) throw new CustodyError("A dropdown or multiple choice needs at least two options, separated by commas.");
      await tx
        .update(customFields)
        .set({ label: input.label, ...(HAS_OPTIONS.includes(f.type) && { options }) })
        .where(eq(customFields.id, fieldId));
    });
    revalidatePath("/setup");
    return { ok: "Field saved." };
  });
}
