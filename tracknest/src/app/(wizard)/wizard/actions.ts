"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withOrg } from "@/db";
import { organizations, type AssetFormSetup } from "@/db/schema";
import { saveCompany } from "@/app/(app)/setup/company/actions";
import { FORM_FIELDS } from "@/lib/asset-form-setup";
import { requireUser } from "@/lib/auth";
import { handle, type FormState } from "@/lib/form";
import { applySwitches, completeStep, LAST_STEP, STEP_SWITCHES } from "@/lib/wizard";

/** Inside handle(), whose redirect passes through. */
async function moveOn(orgId: string, step: number) {
  await withOrg(orgId, (tx) => completeStep(tx, orgId, step));
  revalidatePath("/", "layout");
  redirect(step >= LAST_STEP ? "/dashboard" : `/wizard?step=${step + 1}`);
}

export async function saveCompanyStep(state: FormState, form: FormData): Promise<FormState> {
  const saved = await saveCompany(state, form);
  if (saved?.error) return saved;
  return handle(async () => moveOn((await requireUser("admin")).orgId, 1));
}

/** Sites, locations and categories save as they're added, so Continue only moves on. */
export async function continueStep(step: number): Promise<FormState> {
  return handle(async () => moveOn((await requireUser("admin")).orgId, step));
}

export async function saveDatabaseStep(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    await withOrg(user.orgId, async (tx) => {
      const [org] = await tx.select({ setup: organizations.assetForm }).from(organizations).where(eq(organizations.id, user.orgId));
      const assetForm: AssetFormSetup = {};
      // Labels and order set in the form designer stay as they are.
      for (const f of FORM_FIELDS) assetForm[f.key] = { ...org.setup[f.key], hidden: form.get(`include_${f.key}`) !== "on", required: form.get(`required_${f.key}`) === "yes" };
      await tx.update(organizations).set({ assetForm }).where(eq(organizations.id, user.orgId));
    });
    await moveOn(user.orgId, 5);
  });
}

export async function saveSwitchStep(step: number, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    await withOrg(user.orgId, async (tx) => {
      const [org] = await tx.select({ disabled: organizations.disabledFeatures }).from(organizations).where(eq(organizations.id, user.orgId));
      const disabledFeatures = applySwitches(org.disabled, STEP_SWITCHES[step], (k) => form.get(k) === "no");
      await tx.update(organizations).set({ disabledFeatures }).where(eq(organizations.id, user.orgId));
    });
    await moveOn(user.orgId, step);
  });
}
