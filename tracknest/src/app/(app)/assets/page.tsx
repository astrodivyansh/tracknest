import Link from "next/link";
import { and, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { withOrg } from "@/db";
import { assets, ASSET_STATUSES, categories, checkouts, locations } from "@/db/schema";
import { canEdit, requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/custody";
import { fmtDate } from "@/lib/format";
import { btn, btnSecondary, h1, input, STATUS_BADGE, td, th } from "@/lib/ui";

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" && (ASSET_STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";

  const where: SQL[] = [isNull(assets.deletedAt)];
  if (q) {
    const like = `%${q}%`;
    where.push(or(ilike(assets.tag, like), ilike(assets.name, like), ilike(assets.serial, like), ilike(assets.model, like))!);
  }
  if (status) where.push(eq(assets.status, status as (typeof ASSET_STATUSES)[number]));

  // shortcut: capped at 500 rows, no pagination yet; add cursor paging before large orgs onboard.
  const rows = await withOrg(user.orgId, (tx) =>
    tx
      .select({
        id: assets.id,
        tag: assets.tag,
        name: assets.name,
        status: assets.status,
        category: categories.name,
        location: locations.name,
        holder: checkouts.holderName,
        dueAt: checkouts.dueAt,
      })
      .from(assets)
      .leftJoin(categories, eq(categories.id, assets.categoryId))
      .leftJoin(locations, eq(locations.id, assets.locationId))
      .leftJoin(checkouts, and(eq(checkouts.assetId, assets.id), eq(checkouts.state, "open")))
      .where(and(...where))
      .orderBy(desc(assets.createdAt))
      .limit(500),
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={h1}>Assets</h1>
        {canEdit(user) && (
          <Link href="/assets/new" className={btn}>
            Add asset
          </Link>
        )}
      </div>

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search tag, name, serial, model" className={`${input} max-w-sm`} />
        <select name="status" defaultValue={status} className={`${input} max-w-48`}>
          <option value="">All statuses</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button className={btnSecondary}>Filter</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className={th}>Tag</th>
              <th className={th}>Name</th>
              <th className={th}>Category</th>
              <th className={th}>Location</th>
              <th className={th}>Status</th>
              <th className={th}>Held by</th>
              <th className={th}>Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((a) => (
              <tr key={a.id}>
                <td className={td}>
                  <Link href={`/assets/${a.id}`} className="font-mono font-medium text-indigo-600 hover:underline">
                    {a.tag}
                  </Link>
                </td>
                <td className={td}>{a.name}</td>
                <td className={td}>{a.category ?? "—"}</td>
                <td className={td}>{a.location ?? "—"}</td>
                <td className={td}>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                </td>
                <td className={td}>{a.holder ?? "—"}</td>
                <td className={td}>{a.dueAt ? fmtDate(a.dueAt, user.timezone) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className={`${td} text-gray-500`}>
                  {q || status ? "No assets match." : "No assets yet. Add your first one."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
