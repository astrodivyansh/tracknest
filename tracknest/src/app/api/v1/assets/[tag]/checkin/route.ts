import { z } from "zod";
import { withOrg } from "@/db";
import { api, readJson } from "@/lib/api";
import { assetIdByTag, oneAsset } from "@/lib/api-assets";
import { checkIn } from "@/lib/custody";

const body = z.object({
  returnLocationId: z.uuid().optional(),
  condition: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const POST = api<{ tag: string }>("write", async (ctx, req, { tag }) => {
  const input = body.parse(await readJson(req, { optional: true })); // a plain check-in needs no body
  return withOrg(ctx.orgId, async (tx) => {
    const id = await assetIdByTag(tx, tag);
    await checkIn(tx, ctx.actor, { assetId: id, ...input, source: "api" });
    return oneAsset(tx, ctx, id);
  });
});
