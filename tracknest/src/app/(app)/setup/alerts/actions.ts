"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { emailTemplates, organizations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { EMAIL_EVENTS } from "@/lib/event-mail";
import { fields, handle, reqText, type FormState } from "@/lib/form";

const days = (label: string) => z.coerce.number(`${label} must be a number of days`).int().min(1, `${label}: at least 1 day`).max(365, `${label}: at most 365 days`);
const checked = z.literal("on").optional().transform(Boolean);

export async function saveAlertSettings(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const alertSettings = z
      .object({ holderReminders: checked, maintenanceDays: days("Maintenance"), warrantyDays: days("Warranties") })
      .parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.update(organizations).set({ alertSettings }).where(eq(organizations.id, user.orgId)));
    revalidatePath("/setup/alerts");
    return { ok: "Alert settings saved." };
  });
}

export async function saveTemplate(event: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const def = EMAIL_EVENTS.find((e) => e.event === event);
    if (!def) throw new Error(`No email for event ${event}`);
    const input = z
      .object({ enabled: checked, toHolder: checked, toManagers: checked, subject: reqText("Subject"), body: reqText("Message") })
      .parse(fields(form));
    const values = { ...input, updatedAt: new Date() };
    await withOrg(user.orgId, (tx) =>
      tx
        .insert(emailTemplates)
        .values({ orgId: user.orgId, event: def.event, ...values })
        .onConflictDoUpdate({ target: [emailTemplates.orgId, emailTemplates.event], set: values }),
    );
    revalidatePath("/setup/alerts");
    return { ok: input.enabled ? `“${def.label}” emails are on.` : `“${def.label}” saved (off).` };
  });
}
