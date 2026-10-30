"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { customEvents, organizations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fields, handle, reqText, type FormState } from "@/lib/form";
import { ACTION_KEYS, ACTIONS } from "@/lib/permissions";

export async function saveFeatures(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const on = new Set(form.getAll("on").map(String));
    const disabledFeatures = ACTION_KEYS.filter((a) => ACTIONS[a].feature && !on.has(a));
    await withOrg(user.orgId, (tx) => tx.update(organizations).set({ disabledFeatures }).where(eq(organizations.id, user.orgId)));
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  });
}

export async function addCustomEvent(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const { name } = z.object({ name: reqText("Event name").max(60) }).parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(customEvents).values({ orgId: user.orgId, name }));
    revalidatePath("/setup/events");
    return { ok: `“${name}” added.` };
  });
}

// Recorded events keep their name in history, so removing a type never changes the past.
export async function removeCustomEvent(id: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    await withOrg(user.orgId, (tx) => tx.delete(customEvents).where(eq(customEvents.id, id)));
    revalidatePath("/setup/events");
  });
}
