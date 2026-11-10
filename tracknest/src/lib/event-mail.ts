import { after } from "next/server";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assetEvents, assets, checkouts, customers, emailTemplates, organizations, persons, reservations, users, type EventType } from "@/db/schema";
import { deliver } from "./alerts";
import { appOrigin, getCurrentUser } from "./auth";
import { describeEvent, fmtDate, fmtDateTime } from "./format";
import { sendMail, type Mail } from "./mail";

/** Events an admin can turn emails on for, with the built-in wording (off until saved as on). */
export const EMAIL_EVENTS: { event: EventType; label: string; subject: string; body: string }[] = [
  {
    event: "checked_out",
    label: "Checked out / leased",
    subject: "{tag} {name} is now with {holder}",
    body: "Hi {holder},\n\n{name} ({tag}) has been checked out to you by {by}.\nDue back: {due}\n{details}\n\n{link}\n— {org}",
  },
  {
    event: "checked_in",
    label: "Checked in / lease returned",
    subject: "{tag} {name} has been returned",
    body: "Hi {holder},\n\nThanks, {name} ({tag}) has been checked in by {by}.\n{details}\n\n— {org}",
  },
  {
    event: "due_extended",
    label: "Due date changed",
    subject: "New due date for {tag} {name}",
    body: "Hi {holder},\n\n{details}\n\n{link}\n— {org}",
  },
  {
    event: "reserved",
    label: "Reserved",
    subject: "{tag} {name} is reserved for {holder}",
    body: "Hi {holder},\n\n{details}\n\n{link}\n— {org}",
  },
  {
    event: "status_changed",
    label: "Status changed (broken, lost, disposed…)",
    subject: "{tag} {name}: status changed",
    body: "{details}\nBy {by} on {date}.\n\n{link}\n— {org}",
  },
  {
    event: "maintenance_completed",
    label: "Maintenance completed",
    subject: "Maintenance done on {tag} {name}",
    body: "{details}\nBy {by} on {date}.\n\n{link}\n— {org}",
  },
];

/** Fills {placeholders}; unknown ones are left as typed so a typo is visible. */
export const render = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

export async function templatesFor(orgId: string) {
  const saved = await withOrg(orgId, (tx) => tx.select().from(emailTemplates));
  return EMAIL_EVENTS.map((d) => {
    const s = saved.find((t) => t.event === d.event);
    return { ...d, enabled: s?.enabled ?? false, toHolder: s?.toHolder ?? true, toManagers: s?.toManagers ?? false, subject: s?.subject ?? d.subject, body: s?.body ?? d.body, updatedAt: s?.updatedAt ?? null };
  });
}

const LOOKBACK_MS = 2 * 864e5; // the cron catches up on anything the after-action send missed

/**
 * Emails recent events of the types an org has turned on. Safe to run any number of times:
 * each (event, recipient) is claimed once in alert_log.
 */
export async function sendEventEmails({
  orgId,
  now = new Date(),
  send = sendMail,
  origin = process.env.APP_URL ?? "http://localhost:3000",
}: { orgId: string; now?: Date; send?: (m: Mail) => Promise<void>; origin?: string }) {
  const on = (await templatesFor(orgId)).filter((t) => t.enabled && t.updatedAt && (t.toHolder || t.toManagers));
  if (on.length === 0) return 0;
  const [org] = await db.select({ name: organizations.name, tz: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
  const since = new Date(now.getTime() - LOOKBACK_MS);

  const rows = await withOrg(orgId, (tx) =>
    tx
      .select({
        e: assetEvents,
        tag: assets.tag,
        name: assets.name,
        coHolderType: checkouts.holderType,
        coHolderId: checkouts.holderId,
        coHolderName: checkouts.holderName,
        dueAt: checkouts.dueAt,
        resHolderType: reservations.holderType,
        resHolderId: reservations.holderId,
        resHolderName: reservations.holderName,
      })
      .from(assetEvents)
      .innerJoin(assets, eq(assets.id, assetEvents.assetId))
      // Only events after the template was switched on or edited (compared in SQL: microseconds, not JS milliseconds).
      .innerJoin(emailTemplates, and(eq(emailTemplates.event, assetEvents.type), gte(assetEvents.occurredAt, emailTemplates.updatedAt)))
      .leftJoin(checkouts, eq(checkouts.id, assetEvents.checkoutId))
      // Reservation events carry the reservation id in their payload.
      .leftJoin(reservations, eq(reservations.id, sql`(${assetEvents.payload}->>'reservationId')::uuid`))
      .where(and(inArray(assetEvents.type, on.map((t) => t.event)), gte(assetEvents.occurredAt, since)))
      .orderBy(asc(assetEvents.occurredAt))
      .limit(500),
  );
  if (rows.length === 0) return 0;

  const managers = on.some((t) => t.toManagers)
    ? await db
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.orgId, orgId), inArray(users.role, ["manager", "admin", "owner"]), eq(users.emailAlerts, true), isNull(users.deletedAt)))
    : [];

  let sent = 0;
  for (const r of rows) {
    const t = on.find((x) => x.event === r.e.type)!;
    const holderType = r.coHolderType ?? r.resHolderType;
    const holderId = r.coHolderId ?? r.resHolderId;
    const holder = r.coHolderName ?? r.resHolderName ?? "";
    const to = new Set<string>(t.toManagers ? managers.map((m) => m.email.toLowerCase()) : []);
    if (t.toHolder && holderId && (holderType === "person" || holderType === "customer")) {
      const table = holderType === "person" ? persons : customers;
      const [h] = await withOrg(orgId, (tx) => tx.select({ email: table.email }).from(table).where(eq(table.id, holderId)));
      if (h?.email) to.add(h.email.toLowerCase());
    }
    const vars = {
      tag: r.tag,
      name: r.name,
      holder,
      by: r.e.actorName,
      date: fmtDateTime(r.e.occurredAt, org.tz),
      due: r.dueAt ? fmtDate(r.dueAt, org.tz) : "no due date",
      details: describeEvent(r.e, org.tz),
      link: `${origin}/assets/${r.e.assetId}`,
      org: org.name,
    };
    for (const email of to) {
      const res = await deliver(orgId, { key: `event:${r.e.id}:${email}`, mail: { to: email, subject: render(t.subject, vars), text: render(t.body, vars) } }, send);
      if (res === "sent") sent++;
    }
  }
  return sent;
}

/** Called by every server action (lib/form.ts handle): emails what it recorded, after the response is sent. */
export async function afterAction() {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const origin = await appOrigin();
    after(() => sendEventEmails({ orgId: user.orgId, origin }).catch((e) => console.error("event emails failed", e)));
  } catch {
    // Outside a request (tests, scripts): the hourly cron sends them.
  }
}
