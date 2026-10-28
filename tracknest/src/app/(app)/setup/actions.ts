"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOrg } from "@/db";
import { categories, departments, locations, sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fields, handle, optText, reqText, type FormState } from "@/lib/form";

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
    const input = z.object({ name: reqText("Category name") }).parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(categories).values({ orgId: user.orgId, ...input }));
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
