"use server";

import { revalidatePath } from "next/cache";
import { withOrg } from "@/db";
import { requireUser } from "@/lib/auth";
import { allow } from "@/lib/permissions";
import { CustodyError } from "@/lib/custody";
import { handle, type FormState } from "@/lib/form";
import { importAssets, importPeople } from "@/lib/import";
import { IMPORTERS } from "@/lib/import-more";

const MAX_BYTES = 5 * 1024 * 1024;

async function readFile(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new CustodyError("Choose a CSV file.");
  if (file.size > MAX_BYTES) throw new CustodyError("The file is larger than 5 MB; split it up.");
  if (/\.xlsx?$/i.test(file.name)) throw new CustodyError("Save the spreadsheet as CSV (File → Save as → CSV UTF-8) and upload that.");
  return file.text();
}

const summary = (r: { imported: number; skipped: number; ignored: string[] }, noun: string) =>
  [
    `Imported ${r.imported} ${noun}.`,
    r.skipped && `Skipped ${r.skipped} already on file.`,
    r.ignored.length && `Ignored columns: ${r.ignored.join(", ")}.`,
  ]
    .filter(Boolean)
    .join(" ");

export async function importAssetsAction(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "add");
    const text = await readFile(form);
    const r = await withOrg(user.orgId, (tx) => importAssets(tx, { id: user.id, name: user.name, orgId: user.orgId }, text));
    revalidatePath("/assets");
    return { ok: summary(r, "assets") };
  });
}

export async function importPeopleAction(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "people");
    const text = await readFile(form);
    const r = await withOrg(user.orgId, (tx) => importPeople(tx, { id: user.id, name: user.name, orgId: user.orgId }, text));
    revalidatePath("/people");
    return { ok: summary(r, "people") };
  });
}

/** The other tables (lib/import-more.ts). */
export async function importTableAction(table: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const imp = Object.hasOwn(IMPORTERS, table) ? IMPORTERS[table] : null;
    if (!imp) throw new CustodyError("Unknown table.");
    const user = imp.needs === "admin" ? await requireUser("admin") : allow(await requireUser("manager"), imp.needs);
    const text = await readFile(form);
    const r = await withOrg(user.orgId, (tx) => imp.run(tx, { id: user.id, name: user.name, orgId: user.orgId }, text));
    revalidatePath("/", "layout");
    return { ok: summary(r, "rows") };
  });
}
