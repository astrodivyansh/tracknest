import { and, asc, eq } from "drizzle-orm";
import { withOrg } from "@/db";
import { assets, categories, checkouts, customFields, departments, locations, sites } from "@/db/schema";
import { assetFilters } from "@/lib/assets";
import { requireUser } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { STATUS_LABEL } from "@/lib/custody";
import { isoDateIn } from "@/lib/format";

// shortcut: whole CSV in memory, capped at 100k rows; stream it if orgs outgrow that.
const MAX_ROWS = 100_000;

/** The asset list exactly as filtered on screen, with every standard and custom field. */
export async function GET(request: Request) {
  const user = await requireUser();
  const { where } = assetFilters(Object.fromEntries(new URL(request.url).searchParams));
  const { rows, defs } = await withOrg(user.orgId, async (tx) => ({
    defs: await tx.select().from(customFields).orderBy(asc(customFields.createdAt)),
    rows: await tx
      .select({
        tag: assets.tag, name: assets.name, category: categories.name, brand: assets.brand, model: assets.model,
        serial: assets.serial, site: sites.name, location: locations.name, department: departments.name,
        status: assets.status, holder: checkouts.holderName, dueAt: checkouts.dueAt, condition: assets.condition,
        purchaseDate: assets.purchaseDate, cost: assets.cost, purchasedFrom: assets.purchasedFrom, notes: assets.notes, custom: assets.custom,
      })
      .from(assets)
      .leftJoin(categories, eq(categories.id, assets.categoryId))
      .leftJoin(sites, eq(sites.id, assets.siteId))
      .leftJoin(locations, eq(locations.id, assets.locationId))
      .leftJoin(departments, eq(departments.id, assets.departmentId))
      .leftJoin(checkouts, and(eq(checkouts.assetId, assets.id), eq(checkouts.state, "open")))
      .where(and(...where))
      .orderBy(asc(assets.tag))
      .limit(MAX_ROWS),
  }));
  const header = [
    "Tag", "Name", "Category", "Brand", "Model", "Serial", "Site", "Location", "Department", "Status", "Held by", "Due",
    "Condition", "Purchase date", "Cost", "Purchased from", "Notes", ...defs.map((d) => d.label),
  ];
  return csvResponse(
    `assets-${isoDateIn(new Date(), user.timezone)}.csv`,
    header,
    rows.map((r) => [
      r.tag, r.name, r.category, r.brand, r.model, r.serial, r.site, r.location, r.department, STATUS_LABEL[r.status], r.holder,
      r.dueAt && isoDateIn(r.dueAt, user.timezone), r.condition, r.purchaseDate, r.cost, r.purchasedFrom, r.notes,
      ...defs.map((d) => {
        const v = (r.custom as Record<string, unknown>)[d.id];
        return d.type === "checkbox" && v !== undefined ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join("; ") : v;
      }),
    ]),
  );
}
