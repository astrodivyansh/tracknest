"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { WIDGET_KEYS } from "@/lib/dashboard-widgets";
import { handle, type FormState } from "@/lib/form";

// users is a global table (no RLS); this updates only the signed-in user's own row.
export async function saveDashboard(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    const pos = (k: string) => Number(form.get(`position_${k}`)) || 99;
    const dashboard = WIDGET_KEYS.filter((k) => form.get(`show_${k}`) === "on").sort((a, b) => pos(a) - pos(b));
    await db.update(users).set({ dashboard }).where(eq(users.id, user.id));
    revalidatePath("/dashboard");
    return { ok: "Dashboard saved." };
  });
}

export async function resetDashboard(): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    await db.update(users).set({ dashboard: null }).where(eq(users.id, user.id));
    revalidatePath("/dashboard", "layout");
    return { ok: "Back to the standard dashboard." };
  });
}
