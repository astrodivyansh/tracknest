import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { assets, customFields } from "@/db/schema";

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Date custom fields with a reminder (e.g. "Warranty expiry", 30 days) whose value falls between
 * today and today + that many days, soonest first. Disposed and archived assets are left out.
 */
export async function upcomingDates(tx: Tx, today: string, limit = 50) {
  const fields = await tx
    .select({ id: customFields.id, label: customFields.label, days: customFields.remindDays })
    .from(customFields)
    .where(and(eq(customFields.type, "date"), isNotNull(customFields.remindDays)));
  const found = await Promise.all(
    fields.map(async (f) => {
      // Values are stored as YYYY-MM-DD, so text comparison orders them correctly.
      const value = sql<string>`${assets.custom}->>${f.id}`;
      const rows = await tx
        .select({ assetId: assets.id, tag: assets.tag, name: assets.name, date: value })
        .from(assets)
        .where(and(isNull(assets.deletedAt), ne(assets.status, "disposed"), sql`${value} between ${today} and ${addDays(today, f.days!)}`))
        .limit(limit);
      return rows.map((r) => ({ ...r, label: f.label }));
    }),
  );
  return found
    .flat()
    .sort((a, b) => a.date.localeCompare(b.date) || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/** Values of reminder date fields (e.g. warranty expiry) between two dates, for the dashboard calendar. */
export async function datesInRange(tx: Tx, from: string, to: string) {
  const fields = await tx
    .select({ id: customFields.id, label: customFields.label })
    .from(customFields)
    .where(and(eq(customFields.type, "date"), isNotNull(customFields.remindDays)));
  const found = await Promise.all(
    fields.map(async (f) => {
      const value = sql<string>`${assets.custom}->>${f.id}`;
      const rows = await tx
        .select({ assetId: assets.id, tag: assets.tag, name: assets.name, date: value })
        .from(assets)
        .where(and(isNull(assets.deletedAt), ne(assets.status, "disposed"), sql`${value} between ${from} and ${to}`));
      return rows.map((r) => ({ ...r, label: f.label }));
    }),
  );
  return found.flat();
}
