import { withOrg } from "@/db";
import { api } from "@/lib/api";
import { getLookups } from "@/lib/lookups";

export const GET = api("read", (ctx) =>
  withOrg(ctx.orgId, async (tx) => {
    const l = await getLookups(tx);
    return {
      sites: l.sites,
      locations: l.locations.map(({ id, name, siteId }) => ({ id, name, siteId })),
      categories: l.categories,
      departments: l.departments,
      customFields: l.customFields.map(({ label, type, options, required, categoryId }) => ({ label, type, options, required, categoryId })),
    };
  }),
);
