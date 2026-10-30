import { and, count } from "drizzle-orm";
import { withOrg } from "@/db";
import { assets } from "@/db/schema";
import { api, ApiError, paging, readJson } from "@/lib/api";
import { customByLabel, loadAssets, oneAsset } from "@/lib/api-assets";
import { assetFilters, assetSchema, insertAsset } from "@/lib/assets";
import { parseCustom } from "@/lib/custom-fields";

export const GET = api("read", async (ctx, req) => {
  const { where } = assetFilters(Object.fromEntries(new URL(req.url).searchParams));
  const p = paging(req);
  return withOrg(ctx.orgId, async (tx) => ({
    data: await loadAssets(tx, ctx, where, p),
    page: p.page,
    limit: p.limit,
    total: (await tx.select({ n: count() }).from(assets).where(and(...where)))[0].n,
  }));
});

export const POST = api("write", async (ctx, req) => {
  const body = await readJson(req);
  const input = assetSchema.parse(body);
  const asset = await withOrg(ctx.orgId, async (tx) => {
    const { defs, raw } = await customByLabel(tx, body.customFields);
    const custom = parseCustom(defs, raw, input.categoryId);
    if (custom.errors.length) throw new ApiError(400, "bad_request", custom.errors.join(" "));
    const a = await insertAsset(tx, ctx.actor, { ...input, custom: custom.values }, "api");
    return oneAsset(tx, ctx, a.id);
  });
  return Response.json(asset, { status: 201 });
});
