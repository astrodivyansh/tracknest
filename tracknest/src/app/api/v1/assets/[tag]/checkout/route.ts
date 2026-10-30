import { z } from "zod";
import { withOrg } from "@/db";
import { HOLDER_TYPES } from "@/db/schema";
import { api, readJson } from "@/lib/api";
import { assetIdByTag, oneAsset } from "@/lib/api-assets";
import { checkOut } from "@/lib/custody";
import { endOfDayIn } from "@/lib/format";

const body = z.object({
  holder: z.object({ type: z.enum(HOLDER_TYPES), id: z.uuid() }),
  dueDate: z.iso.date().optional(),
  condition: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const POST = api<{ tag: string }>("write", async (ctx, req, { tag }) => {
  const input = body.parse(await readJson(req));
  return withOrg(ctx.orgId, async (tx) => {
    const id = await assetIdByTag(tx, tag);
    await checkOut(tx, ctx.actor, {
      assetId: id,
      holderType: input.holder.type,
      holderId: input.holder.id,
      dueAt: input.dueDate ? endOfDayIn(input.dueDate, ctx.tz) : null,
      condition: input.condition,
      notes: input.notes,
      source: "api",
    });
    return oneAsset(tx, ctx, id);
  });
});
