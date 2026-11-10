"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { SUBSCRIPTION_STATES, subscriptionLinks, subscriptions } from "@/db/schema";
import { parseTags } from "@/lib/audits";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { fields, handle, optId, optText, reqText, type FormState } from "@/lib/form";
import { allow } from "@/lib/permissions";
import { deleteObject, putObject } from "@/lib/storage";
import { linkToSubscription, nextSubscriptionTag, recordRecharge } from "@/lib/subscriptions";

const actorOf = (u: CurrentUser) => ({ id: u.id, name: u.name, orgId: u.orgId });
const wholeNumber = (what: string, min: number, max: number) =>
  z.union([z.literal(""), z.coerce.number(`${what} must be a whole number`).int(`${what} must be a whole number`).min(min).max(max, `${what} can be at most ${max}`)]);

const schema = z.object({
  name: reqText("Name"),
  vendor: optText,
  plan: optText,
  amount: z
    .string()
    .transform((v) => v.replace(/[,\s]/g, ""))
    .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter the billing amount, e.g. 12500 or 19.99")),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code like INR or USD"),
  periodMonths: z.coerce.number("Choose how often it's recharged").int().min(1, "Choose how often it's recharged").max(60, "At most every 60 months"),
  nextDueOn: z.iso.date("Pick the next recharge date"),
  autoRenew: z.literal("on").optional().transform((v) => v === "on"),
  seats: wholeNumber("Seats", 1, 100000).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  ownerId: optId,
  remindDays: wholeNumber("Remind days", 0, 90).optional().transform((v) => (v === "" || v === undefined ? 7 : v)),
  notes: optText,
});

export async function addSubscription(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    const input = schema.parse(fields(form));
    const [s] = await withOrg(user.orgId, async (tx) =>
      tx.insert(subscriptions).values({ ...input, orgId: user.orgId, tag: await nextSubscriptionTag(tx, user.orgId), createdBy: user.name }).returning(),
    );
    redirect(`/subscriptions/${s.id}`);
  });
}

export async function updateSubscription(id: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    const input = schema.extend({ state: z.enum(SUBSCRIPTION_STATES) }).parse(fields(form));
    const [row] = await withOrg(user.orgId, (tx) => tx.update(subscriptions).set(input).where(eq(subscriptions.id, id)).returning({ id: subscriptions.id }));
    if (!row) throw new CustodyError("Subscription not found.");
    revalidatePath("/subscriptions", "layout");
    return { ok: "Saved." };
  });
}

export async function rechargeAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    const input = z
      .object({
        forDue: z.iso.date(),
        paidOn: z.iso.date("Pick the date it was paid"),
        amount: z
          .string()
          .optional()
          .transform((v) => v?.replace(/[,\s]/g, "") || null)
          .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter the amount paid, e.g. 12500 or 19.99").nullable()),
        reference: optText,
        notes: optText,
      })
      .parse(fields(form));
    const file = form.get("invoice");
    const invoice = file instanceof File && file.size > 0 ? { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
    // Bytes go to storage inside the transaction; a failure afterwards removes them again.
    let stored: string | null = null;
    try {
      await withOrg(user.orgId, async (tx) => {
        const p = await recordRecharge(tx, actorOf(user), { subscriptionId: id, ...input, invoice });
        if (invoice && p.invoiceKey) {
          await putObject(p.invoiceKey, invoice.bytes);
          stored = p.invoiceKey;
        }
      });
    } catch (e) {
      if (stored) await deleteObject(stored);
      throw e;
    }
    revalidatePath("/", "layout");
    return { ok: "Recharge recorded. The next due date has moved on." };
  });
}

export async function linkAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    const tags = parseTags(String(form.get("tags") ?? ""));
    const personIds = form.getAll("personId").map(String).filter(Boolean);
    if (tags.length === 0 && personIds.length === 0) throw new CustodyError("Enter asset tags or pick a person.");
    const n = await withOrg(user.orgId, (tx) => linkToSubscription(tx, actorOf(user), { subscriptionId: id, tags, personIds }));
    revalidatePath(`/subscriptions/${id}`);
    return { ok: n ? `Linked ${n}.` : "Already linked." };
  });
}

export async function unlinkAction(id: string, linkId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "records");
    await withOrg(user.orgId, (tx) => tx.delete(subscriptionLinks).where(and(eq(subscriptionLinks.id, linkId), eq(subscriptionLinks.subscriptionId, id))));
    revalidatePath(`/subscriptions/${id}`);
  });
}

