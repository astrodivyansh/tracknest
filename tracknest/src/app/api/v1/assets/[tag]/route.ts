import { withOrg } from "@/db";
import { api } from "@/lib/api";
import { assetIdByTag, oneAsset } from "@/lib/api-assets";

export const GET = api<{ tag: string }>("read", (ctx, _req, { tag }) =>
  withOrg(ctx.orgId, async (tx) => oneAsset(tx, ctx, await assetIdByTag(tx, tag))),
);
