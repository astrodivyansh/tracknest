import { desc, eq } from "drizzle-orm";
import { withOrg } from "@/db";
import { assetEvents, assets } from "@/db/schema";
import { api, paging } from "@/lib/api";
import { assetIdByTag, toEvent } from "@/lib/api-assets";

export const GET = api<{ tag: string }>("read", (ctx, req, { tag }) =>
  withOrg(ctx.orgId, async (tx) => {
    const id = await assetIdByTag(tx, tag);
    const rows = await tx
      .select({
        id: assetEvents.id,
        type: assetEvents.type,
        payload: assetEvents.payload,
        occurredAt: assetEvents.occurredAt,
        actorName: assetEvents.actorName,
        source: assetEvents.source,
        assetTag: assets.tag,
      })
      .from(assetEvents)
      .innerJoin(assets, eq(assets.id, assetEvents.assetId))
      .where(eq(assetEvents.assetId, id))
      .orderBy(desc(assetEvents.occurredAt))
      .limit(paging(req).limit);
    return { data: rows.map((e) => toEvent(e, ctx.tz)) };
  }),
);
