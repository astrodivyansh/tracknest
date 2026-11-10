import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { assets, persons, subscriptionLinks, subscriptionPayments, subscriptions, users } from "@/db/schema";
import { deliver } from "./alerts";
import { CustodyError, type Actor } from "./custody";
import { cleanName, detectType, MAX_FILE_BYTES } from "./files";
import { fmtMoney } from "./format";
import { sendMail, type Mail } from "./mail";
import { addMonths } from "./maintenance";

export const TAG_PREFIX = "SUB";

/** Common billing periods; any 1–60 months is allowed. */
export const PERIODS: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 6: "Half-yearly", 12: "Yearly" };
export const periodLabel = (months: number) => PERIODS[months] ?? `Every ${months} months`;

/** Cost spread over one month, for comparing plans billed on different periods. */
export const monthlyCost = (amount: string | number, periodMonths: number) => Number(amount) / periodMonths;

/** Where a subscription stands on `today` (YYYY-MM-DD): overdue, due within its reminder window, or fine. */
export function dueState(s: { nextDueOn: string; remindDays: number; state: string }, today: string) {
  if (s.state !== "active") return "off" as const;
  if (s.nextDueOn < today) return "overdue" as const;
  if (s.nextDueOn === today) return "today" as const;
  return addDays(today, s.remindDays) >= s.nextDueOn ? ("soon" as const) : ("ok" as const);
}

/** Percent change from one amount to the next, to one decimal; null when there's nothing to compare. */
export const priceChange = (before: string | number | null | undefined, after: string | number) =>
  before === null || before === undefined || Number(before) === 0 ? null : Math.round(((Number(after) - Number(before)) / Number(before)) * 1000) / 10;

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** The next free SUB-000001 style tag. One writer at a time per org, so two can't get the same number. */
export async function nextSubscriptionTag(tx: Tx, orgId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${orgId}:tag:${TAG_PREFIX}:sub`}))`);
  const [{ last }] = await tx
    .select({ last: sql<string>`coalesce(max(substring(${subscriptions.tag} from ${TAG_PREFIX.length + 2}::int)::bigint), 0)` })
    .from(subscriptions)
    .where(and(eq(subscriptions.orgId, orgId), sql`${subscriptions.tag} ~ ${`^${TAG_PREFIX}-[0-9]+$`}`));
  return `${TAG_PREFIX}-${String(Number(last) + 1).padStart(6, "0")}`;
}

async function lockSubscription(tx: Tx, id: string) {
  const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).for("update");
  if (!s) throw new CustodyError("Subscription not found.");
  return s;
}

export type Invoice = { filename: string; bytes: Uint8Array };

/**
 * Records a recharge and moves the next due date on by one period. The invoice, if any, is checked
 * here; the caller stores its bytes under the returned key (and removes them if the transaction fails).
 */
export async function recordRecharge(
  tx: Tx,
  actor: Actor,
  input: {
    subscriptionId: string;
    /** The due date the form showed; stops a double submit paying the next period too. */
    forDue?: string;
    paidOn: string;
    amount?: string | null;
    reference?: string | null;
    notes?: string | null;
    invoice?: Invoice | null;
    /** Also make this amount the billing amount from now on (e.g. after a price rise). */
    newBilling?: boolean;
  },
) {
  const s = await lockSubscription(tx, input.subscriptionId);
  if (s.state === "cancelled") throw new CustodyError(`${s.tag} is cancelled. Make it active again first.`);
  if (input.forDue && input.forDue !== s.nextDueOn) throw new CustodyError("That recharge is already recorded. Reload the page to see it.");
  let invoice = {};
  if (input.invoice) {
    const name = cleanName(input.invoice.filename);
    if (input.invoice.bytes.length > MAX_FILE_BYTES) throw new CustodyError(`${name} is larger than 10 MB.`);
    const type = detectType(input.invoice.bytes);
    if (!type) throw new CustodyError(`${name}: the invoice must be a PDF or a JPEG, PNG or WebP image.`);
    invoice = { invoiceKey: `${actor.orgId}/${randomUUID()}`, invoiceName: name, invoiceType: type.contentType, invoiceSize: input.invoice.bytes.length };
  }
  const next = addMonths(s.nextDueOn, s.periodMonths);
  const amount = input.amount ?? s.amount;
  // Compared with the last payment, or the billing amount the first time.
  const [last] = await tx
    .select({ amount: subscriptionPayments.amount })
    .from(subscriptionPayments)
    .where(and(eq(subscriptionPayments.subscriptionId, s.id), eq(subscriptionPayments.currency, s.currency)))
    .orderBy(desc(subscriptionPayments.paidOn), desc(subscriptionPayments.recordedAt))
    .limit(1);
  const before = last?.amount ?? s.amount;
  const [payment] = await tx
    .insert(subscriptionPayments)
    .values({
      orgId: actor.orgId,
      subscriptionId: s.id,
      paidOn: input.paidOn,
      amount,
      currency: s.currency,
      periodFrom: s.nextDueOn,
      periodTo: next,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      actorName: actor.name,
      ...invoice,
    })
    .returning();
  // A paused subscription that gets paid is in use again.
  await tx
    .update(subscriptions)
    .set({ nextDueOn: next, state: "active", ...(input.newBilling && { amount }) })
    .where(eq(subscriptions.id, s.id));
  return { ...payment, before, change: priceChange(before, amount), subscription: s };
}

/** Links assets (by tag) and people to a subscription. People take seats, so they can't exceed `seats`. */
export async function linkToSubscription(tx: Tx, actor: Actor, input: { subscriptionId: string; tags: string[]; personIds: string[] }) {
  const s = await lockSubscription(tx, input.subscriptionId);
  const found = input.tags.length
    ? await tx
        .select({ id: assets.id, tag: assets.tag })
        .from(assets)
        .where(and(isNull(assets.deletedAt), inArray(sql`upper(${assets.tag})`, input.tags)))
    : [];
  const unknown = input.tags.filter((t) => !found.some((a) => a.tag.toUpperCase() === t));
  if (unknown.length) throw new CustodyError(`No asset has the tag ${unknown.slice(0, 10).join(", ")}.`);
  const people = input.personIds.length
    ? await tx.select({ id: persons.id }).from(persons).where(and(inArray(persons.id, input.personIds), isNull(persons.deletedAt)))
    : [];
  if (people.length !== new Set(input.personIds).size) throw new CustodyError("Pick people from the list.");

  let linked = 0;
  for (const a of found) {
    const [row] = await tx.insert(subscriptionLinks).values({ orgId: actor.orgId, subscriptionId: s.id, assetId: a.id }).onConflictDoNothing().returning();
    if (row) linked++;
  }
  for (const p of people) {
    const [row] = await tx.insert(subscriptionLinks).values({ orgId: actor.orgId, subscriptionId: s.id, personId: p.id }).onConflictDoNothing().returning();
    if (row) linked++;
  }
  if (s.seats !== null) {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(subscriptionLinks)
      .where(and(eq(subscriptionLinks.subscriptionId, s.id), isNotNull(subscriptionLinks.personId)));
    if (n > s.seats) throw new CustodyError(`${s.name} has ${s.seats} seat${s.seats === 1 ? "" : "s"}; that would assign ${n}. Raise the seat count first.`);
  }
  return linked;
}

/** Emails managers (alerts on) when a recharge cost more than the last one. Once per payment. */
export async function notifyPriceRise(
  org: { id: string; name: string },
  p: { id: string; amount: string; currency: string; before: string; change: number | null; subscription: { id: string; tag: string; name: string } },
  origin: string,
  send: (m: Mail) => Promise<void> = sendMail,
) {
  if (p.change === null || p.change <= 0) return 0;
  const managers = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.orgId, org.id), inArray(users.role, ["manager", "admin", "owner"]), eq(users.emailAlerts, true), isNull(users.deletedAt)));
  const s = p.subscription;
  let sent = 0;
  for (const m of managers) {
    const r = await deliver(
      org.id,
      {
        key: `sub-price:${p.id}:${m.email.toLowerCase()}`,
        mail: {
          to: m.email,
          subject: `Price rise: ${s.name} went up ${p.change}%`,
          text: `Hi ${m.name},\n\n${s.name} (${s.tag}) was just recharged for ${fmtMoney(p.amount, p.currency)}, up ${p.change}% from ${fmtMoney(p.before, p.currency)}.\n\n${origin}/subscriptions/${s.id}\n\n— ${org.name}`,
        },
      },
      send,
    );
    if (r === "sent") sent++;
  }
  return sent;
}
