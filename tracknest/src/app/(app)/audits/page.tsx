import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { withOrg } from "@/db";
import { auditItems, audits, categories, locations, sites } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { canEdit, requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { getLookups } from "@/lib/lookups";
import { btn, card, h1, h2, input, label, td, th } from "@/lib/ui";
import { startAuditAction } from "./actions";

export default async function AuditsPage() {
  const user = await requireUser();
  const { rows, lookups } = await withOrg(user.orgId, async (tx) => ({
    rows: await tx
      .select({
        id: audits.id,
        name: audits.name,
        state: audits.state,
        createdAt: audits.createdAt,
        createdBy: audits.createdBy,
        site: sites.name,
        location: locations.name,
        category: categories.name,
        byList: audits.byList,
        expected: sql<number>`(select count(*) from ${auditItems} where ${auditItems.auditId} = ${audits.id} and ${auditItems.expected})::int`,
        found: sql<number>`(select count(*) from ${auditItems} where ${auditItems.auditId} = ${audits.id} and ${auditItems.result} = 'found')::int`,
      })
      .from(audits)
      .leftJoin(sites, eq(sites.id, audits.siteId))
      .leftJoin(locations, eq(locations.id, audits.locationId))
      .leftJoin(categories, eq(categories.id, audits.categoryId))
      .orderBy(desc(audits.createdAt))
      .limit(100),
    lookups: await getLookups(tx),
  }));

  return (
    <>
      <div>
        <h1 className={h1}>Audits</h1>
        <p className="text-sm text-muted-foreground">
          Count what&apos;s really on the shelf: scan every label in a location, then see what&apos;s missing or in the wrong place.
        </p>
      </div>

      {canEdit(user) && (
        <section className={card}>
          <h2 className={h2}>Start an audit</h2>
          <ActionForm action={startAuditAction} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            <label className={label}>
              Name
              <input name="name" required placeholder="e.g. Q4 count — Floor 2" className={input} />
            </label>
            <label className={label}>
              Where
              <select name="scope" defaultValue="all" className={input}>
                <option value="all">Everything</option>
                {lookups.sites.map((s) => (
                  <optgroup key={s.id} label={s.name}>
                    <option value={`site:${s.id}`}>All of {s.name}</option>
                    {lookups.locations
                      .filter((l) => l.siteId === s.id)
                      .map((l) => (
                        <option key={l.id} value={`location:${l.id}`}>
                          {l.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className={label}>
              Category
              <select name="categoryId" defaultValue="" className={input}>
                <option value="">All categories</option>
                {lookups.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${label} sm:col-span-2`}>
              Or paste asset tags (replaces the place and category)
              <textarea name="tags" rows={2} placeholder="TN-000001, TN-000002 … one per line or separated by commas" className={`${input} font-mono text-xs`} />
            </label>
            <button className={btn}>Start audit</button>
          </ActionForm>
          <p className="mt-2 text-xs text-muted-foreground">
            Assets that are available, broken or lost in that place are expected. Checked-out and in-maintenance assets aren&apos;t.
          </p>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Audit</th>
              <th className={th}>Scope</th>
              <th className={th}>Progress</th>
              <th className={th}>Status</th>
              <th className={th}>Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((a) => (
              <tr key={a.id}>
                <td className={td}>
                  <Link href={`/audits/${a.id}`} className="font-medium text-primary hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className={td}>
                  {a.byList ? "Pasted list of tags" : a.location ? `${a.site} — ${a.location}` : (a.site ?? "Everything")}
                  {a.category && ` · ${a.category} only`}
                </td>
                <td className={td}>
                  {a.found} found of {a.expected} expected
                </td>
                <td className={td}>
                  <span className={`rounded px-2 py-0.5 text-xs ${a.state === "open" ? "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300" : "bg-muted text-foreground"}`}>
                    {a.state === "open" ? "In progress" : "Closed"}
                  </span>
                </td>
                <td className={td}>
                  {fmtDate(a.createdAt, user.timezone)} · {a.createdBy}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={`${td} text-muted-foreground`}>
                  No audits yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
