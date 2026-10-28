import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db";
import { assetEvents, assets, EVENT_TYPES, type EventType } from "@/db/schema";
import { endOfDayIn, startOfDayIn } from "./format";

export type HistoryFilters = { from?: string; to?: string; type?: string; q?: string; holder?: string };

/** Reads filters from search params, ignoring anything malformed. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): HistoryFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  return {
    from: date(s("from")),
    to: date(s("to")),
    type: (EVENT_TYPES as readonly string[]).includes(s("type")) ? s("type") : "",
    q: s("q"),
    holder: s("holder"),
  };
}

export function listEvents(tx: Tx, f: HistoryFilters, tz: string, limit: number) {
  const where: SQL[] = [];
  if (f.from) where.push(gte(assetEvents.occurredAt, startOfDayIn(f.from, tz)));
  if (f.to) where.push(lte(assetEvents.occurredAt, endOfDayIn(f.to, tz)));
  if (f.type) where.push(eq(assetEvents.type, f.type as EventType));
  if (f.q) where.push(or(ilike(assets.tag, `%${f.q}%`), ilike(assets.name, `%${f.q}%`))!);
  if (f.holder) where.push(sql`${assetEvents.payload}->>'holderName' ilike ${`%${f.holder}%`}`);
  return tx
    .select({
      id: assetEvents.id,
      type: assetEvents.type,
      payload: assetEvents.payload,
      occurredAt: assetEvents.occurredAt,
      actorName: assetEvents.actorName,
      source: assetEvents.source,
      assetId: assets.id,
      assetTag: assets.tag,
      assetName: assets.name,
    })
    .from(assetEvents)
    .innerJoin(assets, eq(assets.id, assetEvents.assetId))
    .where(and(...where))
    .orderBy(desc(assetEvents.occurredAt))
    .limit(limit);
}
