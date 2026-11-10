import { and, asc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { alertLog, assetRecords, assets, checkouts, inventoryItems, customers, maintenance, organizations, persons, reservations, users, warranties, type AlertSettings } from "@/db/schema";
import { endOfDayIn, fmtDate } from "./format";
import { upcomingDates } from "./reminders";
import { sendMail, type Mail } from "./mail";

/** Alerts go out on the first run at or after this local hour, once per day. */
export const ALERT_HOUR = 8;

/** What an org gets until an admin changes it (Setup → Alerts and emails). */
export const DEFAULT_ALERTS: AlertSettings = { holderReminders: true, maintenanceDays: 7, warrantyDays: 30 };
export const alertSettings = (saved: Partial<AlertSettings>): AlertSettings => ({ ...DEFAULT_ALERTS, ...saved });

type Alert = { key: string; mail: Mail };

/** Calendar date and hour at `now` in `tz`. */
function localNow(now: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Builds and sends one org's alerts for the day. Safe to run every hour: each email has a
 * key in alert_log (unique per org), so it's sent once even if the job runs again or twice at once.
 */
export async function runAlerts({
  now = new Date(),
  send = sendMail,
  origin = process.env.APP_URL ?? "http://localhost:3000",
}: { now?: Date; send?: (m: Mail) => Promise<void>; origin?: string } = {}) {
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name, tz: organizations.timezone, settings: organizations.alertSettings, fyStartMonth: organizations.fyStartMonth })
    .from(organizations);
  let sent = 0;
  let failed = 0;
  for (const org of orgs) {
    // Per-event emails any hour; a dynamic import because event-mail imports this module.
    sent += await (await import("./event-mail")).sendEventEmails({ orgId: org.id, now, send, origin });
    const local = localNow(now, org.tz);
    if (local.hour < ALERT_HOUR) continue;
    sent += await (await import("./saved-reports")).sendScheduledReports(org, local.date, send, origin);
    for (const a of await orgAlerts({ ...org, settings: alertSettings(org.settings) }, local.date, now, origin)) {
      const r = await deliver(org.id, a, send);
      if (r === "sent") sent++;
      if (r === "failed") failed++;
    }
  }
  return { sent, failed };
}

export async function deliver(orgId: string, { key, mail }: Alert, send: (m: Mail) => Promise<void>) {
  const [claim] = await withOrg(orgId, (tx) =>
    tx
      .insert(alertLog)
      .values({ orgId, key, recipient: mail.to, subject: mail.subject })
      .onConflictDoNothing()
      .returning({ id: alertLog.id }),
  );
  if (!claim) return "skipped";
  try {
    await send(mail);
    return "sent";
  } catch (e) {
    // Release the claim so the next run retries.
    await withOrg(orgId, (tx) => tx.delete(alertLog).where(eq(alertLog.id, claim.id)));
    console.error(`alert ${key} to ${mail.to} failed`, e);
    return "failed";
  }
}

async function orgAlerts(org: { id: string; name: string; tz: string; settings: AlertSettings }, today: string, now: Date, origin: string) {
  const { maintenanceDays, warrantyDays } = org.settings;
  const { overdue, dueToday, jobs, pickups, coming, expiring, lowStock, ending } = await withOrg(org.id, async (tx) => {
    // Open loans with a due date in a range; person and customer holders bring their email.
    const loans = (range: SQL) =>
      tx
        .select({
          checkoutId: checkouts.id,
          assetId: assets.id,
          tag: assets.tag,
          name: assets.name,
          holderName: checkouts.holderName,
          dueAt: sql<Date>`${checkouts.dueAt}`.mapWith(checkouts.dueAt), // non-null: every range filters on it
          email: sql<string | null>`coalesce(${persons.email}, ${customers.email})`,
        })
        .from(checkouts)
        .innerJoin(assets, eq(assets.id, checkouts.assetId))
        .leftJoin(persons, and(eq(checkouts.holderType, "person"), eq(persons.id, checkouts.holderId)))
        .leftJoin(customers, and(eq(checkouts.holderType, "customer"), eq(customers.id, checkouts.holderId)))
        .where(and(eq(checkouts.state, "open"), range))
        .orderBy(asc(checkouts.dueAt));
    return {
      overdue: await loans(lt(checkouts.dueAt, now)),
      dueToday: await loans(and(gte(checkouts.dueAt, now), lte(checkouts.dueAt, endOfDayIn(today, org.tz)))!),
      jobs: await tx
        .select({ assetId: assets.id, tag: assets.tag, name: assets.name, title: maintenance.title, dueDate: maintenance.dueDate })
        .from(maintenance)
        .innerJoin(assets, eq(assets.id, maintenance.assetId))
        .where(and(eq(maintenance.state, "scheduled"), lte(maintenance.dueDate, addDays(today, maintenanceDays))))
        .orderBy(asc(maintenance.dueDate)),
      pickups: await tx
        .select({ assetId: assets.id, tag: assets.tag, name: assets.name, holderName: reservations.holderName, endDate: reservations.endDate })
        .from(reservations)
        .innerJoin(assets, eq(assets.id, reservations.assetId))
        .where(and(eq(reservations.state, "active"), eq(reservations.startDate, today)))
        .orderBy(asc(assets.tag)),
      coming: await upcomingDates(tx, today),
      expiring: await tx
        .select({ assetId: assets.id, tag: assets.tag, name: assets.name, provider: warranties.provider, expiresOn: warranties.expiresOn })
        .from(warranties)
        .innerJoin(assets, eq(assets.id, warranties.assetId))
        .where(and(gte(warranties.expiresOn, today), lte(warranties.expiresOn, addDays(today, warrantyDays)), sql`${assets.deletedAt} is null`, sql`${assets.status} <> 'disposed'`))
        .orderBy(asc(warranties.expiresOn)),
      lowStock: await tx
        .select({ name: inventoryItems.name, quantity: inventoryItems.quantity, unit: inventoryItems.unit })
        .from(inventoryItems)
        .where(sql`${inventoryItems.archivedAt} is null and ${inventoryItems.quantity} <= ${inventoryItems.minQuantity}`)
        .orderBy(asc(inventoryItems.name)),
      ending: await tx
        .select({ id: assetRecords.id, kind: assetRecords.kind, name: assetRecords.name, endDate: assetRecords.endDate })
        .from(assetRecords)
        .where(and(inArray(assetRecords.kind, ["contract", "insurance"]), gte(assetRecords.endDate, today), lte(assetRecords.endDate, addDays(today, warrantyDays))))
        .orderBy(asc(assetRecords.endDate)),
    };
  });

  const link = (assetId: string) => `${origin}/assets/${assetId}`;
  const day = (d: Date) => fmtDate(d, org.tz);
  const plainDay = (d: string) => fmtDate(d, "UTC"); // date-only values have no timezone
  const alerts: Alert[] = [];

  // To the person or customer holding the asset (those with an email only).
  for (const l of org.settings.holderReminders ? dueToday : []) {
    if (!l.email) continue;
    alerts.push({
      key: `due:${l.checkoutId}:${l.dueAt.toISOString()}`,
      mail: {
        to: l.email,
        subject: `Reminder: please return ${l.tag} today`,
        text: `Hi ${l.holderName},\n\n${l.name} (${l.tag}) is due back today, ${day(l.dueAt)}.\nPlease return it, or ask your asset manager to extend the due date.\n\n— ${org.name}`,
      },
    });
  }
  for (const l of org.settings.holderReminders ? overdue : []) {
    if (!l.email) continue;
    const week = Math.floor((now.getTime() - l.dueAt.getTime()) / (7 * 864e5)); // remind once a week
    alerts.push({
      key: `overdue:${l.checkoutId}:${l.dueAt.toISOString()}:${week}`,
      mail: {
        to: l.email,
        subject: `Overdue: please return ${l.tag}`,
        text: `Hi ${l.holderName},\n\n${l.name} (${l.tag}) was due back on ${day(l.dueAt)} and is now overdue.\nPlease return it as soon as possible, or ask your asset manager to extend the due date.\n\n— ${org.name}`,
      },
    });
  }

  // Daily summary to managers and up who haven't turned alerts off.
  const overdueJobs = jobs.filter((j) => j.dueDate! < today);
  const soonJobs = jobs.filter((j) => j.dueDate! >= today);
  const sections = [
    [`Overdue returns (${overdue.length})`, overdue.map((l) => `${l.tag} ${l.name} — ${l.holderName}, due ${day(l.dueAt)}\n  ${link(l.assetId)}`)],
    [`Due back today (${dueToday.length})`, dueToday.map((l) => `${l.tag} ${l.name} — ${l.holderName}\n  ${link(l.assetId)}`)],
    [`Reservations starting today (${pickups.length})`, pickups.map((r) => `${r.tag} ${r.name} — for ${r.holderName}, until ${plainDay(r.endDate)}\n  ${link(r.assetId)}`)],
    [`Dates coming up (${coming.length})`, coming.map((c) => `${c.tag} ${c.name} — ${c.label}: ${plainDay(c.date)}\n  ${link(c.assetId)}`)],
    [`Maintenance overdue (${overdueJobs.length})`, overdueJobs.map((j) => `${j.tag} ${j.name} — ${j.title}, was due ${plainDay(j.dueDate!)}\n  ${link(j.assetId)}`)],
    [`Warranties ending in the next ${warrantyDays} days (${expiring.length})`, expiring.map((w) => `${w.tag} ${w.name} — ${w.provider ?? "warranty"} ends ${plainDay(w.expiresOn)}\n  ${link(w.assetId)}`)],
    [`Contracts and insurance ending in the next ${warrantyDays} days (${ending.length})`, ending.map((r) => `${r.name} (${r.kind}) — ends ${plainDay(r.endDate!)}\n  ${origin}/records/${r.kind}/${r.id}`)],
    [`Low stock (${lowStock.length})`, lowStock.map((i) => `${i.name} — ${Number(i.quantity)} ${i.unit} left\n  ${origin}/inventory`)],
    [`Maintenance due in the next ${maintenanceDays} days (${soonJobs.length})`, soonJobs.map((j) => `${j.tag} ${j.name} — ${j.title}, due ${plainDay(j.dueDate!)}\n  ${link(j.assetId)}`)],
  ] as const;
  if (sections.some(([, lines]) => lines.length > 0)) {
    const managers = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.orgId, org.id), inArray(users.role, ["manager", "admin", "owner"]), eq(users.emailAlerts, true), isNull(users.deletedAt)));
    const body = sections
      .filter(([, lines]) => lines.length > 0)
      .map(([title, lines]) => `${title}\n${lines.map((x) => `• ${x}`).join("\n")}`)
      .join("\n\n");
    for (const m of managers) {
      alerts.push({
        key: `digest:${today}:${m.email.toLowerCase()}`,
        mail: {
          to: m.email,
          subject: `${org.name}: ${overdue.length} overdue, ${dueToday.length} due today, ${jobs.length} maintenance`,
          text: `Hi ${m.name},\n\nHere is today's summary for ${org.name}.\n\n${body}\n\nYou get this because email alerts are on for your account. Turn them off under My account (click your name at the top).\n${origin}/dashboard`,
        },
      });
    }
  }
  return alerts;
}
