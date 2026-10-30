import { asc, eq, sql } from "drizzle-orm";
import { withOrg } from "@/db";
import { assetEvents, assets } from "@/db/schema";
import { api, ApiError, paging } from "@/lib/api";
import { toEvent } from "@/lib/api-assets";

export const GET = api("read", (ctx, req) => {
  const since = new URL(req.url).searchParams.get("since");
  if (since && Number.isNaN(Date.parse(since))) throw new ApiError(400, "bad_request", "since must be an ISO date-time.");
  return withOrg(ctx.orgId, async (tx) => {
    const rows = await tx
      .select({
        id: assetEvents.id,
        type: assetEvents.type,
        payload: assetEvents.payload,
        occurredAt: assetEvents.occurredAt,
        // Microsecond precision: a JS Date would round down and make the next poll repeat the last entry.
        cursor: sql<string>`to_char(${assetEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        actorName: assetEvents.actorName,
        source: assetEvents.source,
        assetTag: assets.tag,
      })
      .from(assetEvents)
      .innerJoin(assets, eq(assets.id, assetEvents.assetId))
      .where(since ? sql`${assetEvents.occurredAt} > ${since}::timestamptz` : undefined)
      .orderBy(asc(assetEvents.occurredAt), asc(assetEvents.id))
      .limit(paging(req).limit);
    return { data: rows.map((e) => toEvent(e, ctx.tz)), nextSince: rows.at(-1)?.cursor ?? since ?? null };
  });
});
