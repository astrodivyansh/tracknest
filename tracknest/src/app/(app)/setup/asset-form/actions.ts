"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { withOrg } from "@/db";
import { organizations, type AssetFormSetup } from "@/db/schema";
import { FORM_FIELDS } from "@/lib/asset-form-setup";
import { requireUser } from "@/lib/auth";
import { handle, type FormState } from "@/lib/form";

export async function saveAssetForm(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const assetForm: AssetFormSetup = {};
    FORM_FIELDS.forEach((f, i) => {
      const label = String(form.get(`label_${f.key}`) ?? "").trim().slice(0, 60);
      const position = Number(form.get(`position_${f.key}`));
      assetForm[f.key] = {
        hidden: form.get(`hidden_${f.key}`) === "on",
        required: form.get(`required_${f.key}`) === "on",
        ...(label && label !== f.label && { label }),
        position: Number.isFinite(position) && position > 0 ? position : i + 1,
      };
    });
    await withOrg(user.orgId, (tx) => tx.update(organizations).set({ assetForm }).where(eq(organizations.id, user.orgId)));
    revalidatePath("/setup/asset-form");
    return { ok: "Asset form saved." };
  });
}
