"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { REPORT_SCHEDULES, savedReports } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { fields, handle, reqText, type FormState } from "@/lib/form";
import { REPORTS } from "@/lib/reports";

const emails = z
  .string()
  .optional()
  .transform((v) => (v ?? "").split(/[\s,;]+/).filter(Boolean))
  .pipe(z.array(z.email("One of the email addresses isn't valid")).max(20, "At most 20 recipients"));

export async function saveReport(slug: string, params: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    if (!REPORTS.some((r) => r.slug === slug)) throw new CustodyError("Unknown report.");
    const input = z
      .object({ name: reqText("Name"), schedule: z.enum(REPORT_SCHEDULES), recipients: emails })
      .parse(fields(form));
    if (input.schedule !== "none" && input.recipients.length === 0) throw new CustodyError("Add at least one email address for a scheduled report.");
    await withOrg(user.orgId, (tx) =>
      tx.insert(savedReports).values({ orgId: user.orgId, slug, params, ...input, createdBy: user.name }),
    );
    revalidatePath("/reports");
    return { ok: `Saved as “${input.name}”. Find it under Reports.` };
  });
}

export async function deleteSavedReport(id: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    await withOrg(user.orgId, (tx) => tx.delete(savedReports).where(eq(savedReports.id, id)));
    revalidatePath("/reports");
  });
}
