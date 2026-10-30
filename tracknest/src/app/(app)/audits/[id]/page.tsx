import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { audits, categories, locations, sites } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { auditRows, GROUP_LABEL, type AuditGroup } from "@/lib/audit-view";
import { canEdit, requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { getLookups } from "@/lib/lookups";
import { btn, btnSecondary, card, h1, h2, td, th } from "@/lib/ui";
import { closeAuditAction } from "../actions";
import { AuditScanner } from "../audit-scanner";

const ORDER: AuditGroup[] = ["pending", "missing", "misplaced", "unexpected", "found"];
const TONE: Record<AuditGroup, string> = {
  pending: "text-foreground",
  missing: "text-red-700 dark:text-red-400",
  misplaced: "text-amber-700 dark:text-amber-400",
  unexpected: "text-amber-700 dark:text-amber-400",
  found: "text-green-700 dark:text-green-400",
};

export default async function AuditPage({ params }: PageProps<"/audits/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withOrg(user.orgId, async (tx) => {
    const [audit] = await tx
      .select({ a: audits, site: sites.name, location: locations.name, category: categories.name })
      .from(audits)
      .leftJoin(sites, eq(sites.id, audits.siteId))
      .leftJoin(locations, eq(locations.id, audits.locationId))
      .leftJoin(categories, eq(categories.id, audits.categoryId))
      .where(eq(audits.id, id));
    if (!audit) return null;
    return { ...audit, rows: await auditRows(tx, id), lookups: await getLookups(tx) };
  });
  if (!data) notFound();
  const { a, rows, lookups } = data;
  const open = a.state === "open";
  const groups = Object.fromEntries(ORDER.map((g) => [g, rows.filter((r) => r.group === g)])) as Record<AuditGroup, typeof rows>;
  const expected = rows.filter((r) => r.expected).length;
  const scanLocations = lookups.locations
    .filter((l) => (a.locationId ? l.id === a.locationId : a.siteId ? l.siteId === a.siteId : true))
    .map((l) => ({ id: l.id, name: a.siteId ? l.name : `${l.siteName} — ${l.name}` }));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/audits" className="text-sm text-primary hover:underline">
            ← Audits
          </Link>
          <h1 className={h1}>{a.name}</h1>
          <p className="text-sm text-muted-foreground">
            {data.a.byList ? "Pasted list of tags" : data.location ? `${data.site} — ${data.location}` : (data.site ?? "Everything")}{data.category && ` · ${data.category} only`} · started {fmtDateTime(a.createdAt, user.timezone)} by{" "}
            {a.createdBy}
            {a.closedAt && ` · closed ${fmtDateTime(a.closedAt, user.timezone)} by ${a.closedBy}`}
          </p>
        </div>
        <a href={`/audits/${a.id}/export`} className={btnSecondary}>
          Download CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {(open ? ORDER : ORDER.filter((g) => g !== "pending")).map((g) => (
          <div key={g} className={card}>
            <p className="text-sm text-muted-foreground">{GROUP_LABEL[g]}</p>
            <p className={`text-2xl font-semibold ${TONE[g]}`}>{groups[g].length}</p>
          </div>
        ))}
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        {expected - groups.pending.length - groups.missing.length} of {expected} expected assets found.
      </p>

      {open && canEdit(user) && (
        <section className={`${card} grid gap-6 md:grid-cols-2`}>
          <div>
            <h2 className={`${h2} mb-3`}>Scan labels</h2>
            <AuditScanner auditId={a.id} locations={scanLocations} defaultLocationId={a.locationId ?? ""} />
          </div>
          <div>
            <h2 className={h2}>Finish</h2>
            <p className="my-2 text-sm text-muted-foreground">
              Closing marks everything not scanned as missing and adds an &ldquo;audited&rdquo; entry to each asset&apos;s history. Scanning
              stops.
            </p>
            <ActionForm action={closeAuditAction.bind(null, a.id)} className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input type="checkbox" name="applyFound" defaultChecked className="mt-1" />
                Move assets found in the wrong place to where they were scanned, and mark lost assets that turned up as found
              </label>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input type="checkbox" name="markMissingLost" className="mt-1" />
                Mark missing assets as lost
              </label>
              <button className={btn}>Close audit</button>
            </ActionForm>
          </div>
        </section>
      )}

      {ORDER.filter((g) => groups[g].length > 0).map((g) => (
        <section key={g} className="space-y-2">
          <h2 className={`${h2} ${TONE[g]}`}>
            {GROUP_LABEL[g]} ({groups[g].length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className={th}>Asset</th>
                  <th className={th}>Should be in</th>
                  <th className={th}>Scanned in</th>
                  <th className={th}>Scanned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups[g].map((r) => (
                  <tr key={r.assetId}>
                    <td className={td}>
                      <Link href={`/assets/${r.assetId}`} className="font-mono text-primary hover:underline">
                        {r.tag}
                      </Link>{" "}
                      {r.name}
                    </td>
                    <td className={td}>{r.expectedLocation ?? "—"}</td>
                    <td className={td}>{r.result === "found" ? (r.foundLocation ?? "Unknown") : "—"}</td>
                    <td className={td}>{r.foundAt ? `${fmtDateTime(r.foundAt, user.timezone)} · ${r.foundBy}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
