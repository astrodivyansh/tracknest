"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withOrg } from "@/db";
import { closeAudit, parseTags, recordScan, startAudit } from "@/lib/audits";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { fields, handle, optId, reqText, type FormState } from "@/lib/form";

const actorOf = (u: CurrentUser) => ({ id: u.id, name: u.name, orgId: u.orgId });

export async function startAuditAction(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    const input = z
      .object({
        name: reqText("Audit name"),
        scope: z.string().regex(/^(all|site:[0-9a-f-]{36}|location:[0-9a-f-]{36})$/, "Choose what to audit"),
        categoryId: optId,
        tags: z.string().optional().transform((v) => parseTags(v ?? "")),
      })
      .refine((v) => v.tags.length <= 5000, "At most 5,000 tags at a time")
      .parse(fields(form));
    const [kind, id] = input.scope.split(":");
    const audit = await withOrg(user.orgId, (tx) =>
      startAudit(tx, actorOf(user), {
        name: input.name,
        siteId: kind === "site" ? id : null,
        locationId: kind === "location" ? id : null,
        categoryId: input.categoryId,
        tags: input.tags,
      }),
    );
    redirect(`/audits/${audit.id}`);
  });
}

const OUTCOME_TEXT = {
  found: "✓ Found",
  misplaced: "⚠ Found, but it belongs somewhere else",
  unexpected: "⚠ Not expected in this audit",
  already: "Already scanned",
};

/** Called by the scanner for every label; returns a line to show the auditor. */
export async function scanAction(auditId: string, raw: string, locationId: string): Promise<string> {
  const user = await requireUser("manager");
  const r = await handle(async () => {
    const res = await withOrg(user.orgId, (tx) => recordScan(tx, actorOf(user), { auditId, raw, locationId: locationId || null }));
    return { ok: `${OUTCOME_TEXT[res.outcome]}: ${res.tag} ${res.name}` };
  });
  revalidatePath(`/audits/${auditId}`);
  return r?.ok ?? `✗ ${r?.error}`;
}

export async function closeAuditAction(auditId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    const f = fields(form);
    const c = await withOrg(user.orgId, (tx) =>
      closeAudit(tx, actorOf(user), { auditId, markMissingLost: f.markMissingLost === "on", applyFound: f.applyFound === "on" }),
    );
    revalidatePath(`/audits/${auditId}`);
    return {
      ok: `Audit closed: ${c.found} found, ${c.missing} missing. ${c.moved} moved, ${c.markedLost} marked lost, ${c.markedFound} marked found.`,
    };
  });
}
