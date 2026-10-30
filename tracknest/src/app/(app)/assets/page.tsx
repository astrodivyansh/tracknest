import Link from "next/link";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { withOrg } from "@/db";
import { assetFiles, assets, ASSET_STATUSES, categories, checkouts, departments, locations } from "@/db/schema";
import { AssetTable, type AssetRow } from "@/components/asset-table";
import { assetFilters } from "@/lib/assets";
import { getLookups } from "@/lib/lookups";
import { requireUser } from "@/lib/auth";
import { BULK, type BulkKind } from "@/lib/labels";
import { BULK_ACTION, can } from "@/lib/permissions";
import { STATUS_LABEL } from "@/lib/custody";
import { fmtDate, fmtMoney } from "@/lib/format";
import { btn, btnSecondary, h1, input, STATUS_BADGE } from "@/lib/ui";

const PAGE_SIZE = 100;

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const user = await requireUser();
  const sp = await searchParams;
  const { q, status, categoryId, locationId, departmentId, where, params } = assetFilters(sp);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const shown = new URLSearchParams({ all: "1", ...params });

  // Offset paging is fine at this size; switch to keyset paging if orgs reach hundreds of thousands of assets.
  const { rows, total, lookups } = await withOrg(user.orgId, async (tx) => ({
    lookups: await getLookups(tx),
    total: (await tx.select({ n: count() }).from(assets).where(and(...where)))[0].n,
    rows: await tx
      .select({
        id: assets.id,
        tag: assets.tag,
        name: assets.name,
        status: assets.status,
        category: categories.name,
        location: locations.name,
        department: departments.name,
        brand: assets.brand,
        model: assets.model,
        serial: assets.serial,
        purchaseDate: assets.purchaseDate,
        cost: assets.cost,
        holder: checkouts.holderName,
        dueAt: checkouts.dueAt,
        // First photo, for the thumbnail column.
        photoId: sql<string | null>`(select f.id from ${assetFiles} f where f.asset_id = ${assets.id} and f.kind = 'photo' order by f.created_at limit 1)`,
      })
      .from(assets)
      .leftJoin(categories, eq(categories.id, assets.categoryId))
      .leftJoin(locations, eq(locations.id, assets.locationId))
      .leftJoin(departments, eq(departments.id, assets.departmentId))
      .leftJoin(checkouts, and(eq(checkouts.assetId, assets.id), eq(checkouts.state, "open")))
      .where(and(...where))
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  }));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tableRows: AssetRow[] = rows.map(({ dueAt, purchaseDate, cost, status, ...r }) => ({
    ...r,
    status: STATUS_LABEL[status],
    statusClass: STATUS_BADGE[status],
    purchaseDate: purchaseDate && fmtDate(purchaseDate, "UTC"),
    cost: cost && fmtMoney(cost, user.currency),
    due: dueAt && fmtDate(dueAt, user.timezone),
  }));
  const pageHref = (n: number) => `/assets?${new URLSearchParams({ ...params, page: String(n) })}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={h1}>Assets</h1>
        <div className="flex gap-2">
          {rows.length > 0 && (
            <>
              <a href={`/assets/export?${new URLSearchParams(params)}`} className={btnSecondary}>
                Export (CSV for Excel)
              </a>
              <Link href={`/labels?${shown}`} className={btnSecondary}>
                Print labels for all shown
              </Link>
            </>
          )}
          {can(user, "add") && (
            <Link href="/assets/new" className={btn}>
              Add asset
            </Link>
          )}
        </div>
      </div>

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search tag, name, serial, model, custom fields" aria-label="Search" className={`${input} max-w-sm`} />
        <select name="status" defaultValue={status} aria-label="Status" className={`${input} max-w-44`}>
          <option value="">All statuses</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="categoryId" defaultValue={categoryId} aria-label="Category" className={`${input} max-w-44`}>
          <option value="">All categories</option>
          {lookups.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="locationId" defaultValue={locationId} aria-label="Location" className={`${input} max-w-52`}>
          <option value="">All locations</option>
          {lookups.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.siteName} — {l.name}
            </option>
          ))}
        </select>
        <select name="departmentId" defaultValue={departmentId} aria-label="Department" className={`${input} max-w-44`}>
          <option value="">All departments</option>
          {lookups.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button className={btnSecondary}>Filter</button>
        {Object.keys(params).length > 0 && (
          <Link href="/assets" className="self-center text-sm text-muted-foreground hover:underline">
            Clear
          </Link>
        )}
      </form>

      <form id="labels" action="/labels">
        <AssetTable rows={tableRows} bulk={(Object.keys(BULK) as BulkKind[]).filter((k) => can(user, BULK_ACTION[k]))} empty={Object.keys(params).length ? "No assets match." : "No assets yet. Add your first one."} />
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span />
        {total > 0 && (
          <nav aria-label="Pages" className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString("en-IN")}
            </span>
            {page > 1 && (
              <Link href={pageHref(page - 1)} className={btnSecondary}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={pageHref(page + 1)} className={btnSecondary}>
                Next
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
