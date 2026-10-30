import Link from "next/link";
import { desc } from "drizzle-orm";
import { withOrg } from "@/db";
import { savedReports } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { canEdit, requireUser } from "@/lib/auth";
import { REPORTS } from "@/lib/reports";
import { card, h1, h2, td, th } from "@/lib/ui";
import { deleteSavedReport } from "./actions";

const SCHEDULE = { none: "—", daily: "Daily", weekly: "Weekly (Mon)", monthly: "Monthly (1st)" };

export default async function ReportsPage() {
  const user = await requireUser();
  const saved = await withOrg(user.orgId, (tx) => tx.select().from(savedReports).orderBy(desc(savedReports.createdAt)));
  const title = (slug: string) => REPORTS.find((r) => r.slug === slug)?.title ?? slug;
  return (
    <>
      <h1 className={h1}>Reports</h1>

      {saved.length > 0 && (
        <section className="space-y-2">
          <h2 className={h2}>Saved and scheduled</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Report</th>
                  <th className={th}>Emailed</th>
                  <th className={th}>To</th>
                  <th className={th}>Saved by</th>
                  {canEdit(user) && <th className={th} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {saved.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>
                      <Link href={`/reports/${s.slug}${s.params ? `?${s.params}` : ""}`} className="font-medium text-primary hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className={td}>{title(s.slug)}</td>
                    <td className={td}>{SCHEDULE[s.schedule]}</td>
                    <td className={`${td} max-w-60 truncate`}>{s.recipients.join(", ") || "—"}</td>
                    <td className={td}>{s.createdBy}</td>
                    {canEdit(user) && (
                      <td className={td}>
                        <ActionForm action={deleteSavedReport.bind(null, s.id)}>
                          <button className="text-sm text-red-600 hover:underline dark:text-red-400">Delete</button>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.slug} href={`/reports/${r.slug}`} className={`${card} hover:border-primary/40`}>
            <h2 className={h2}>{r.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
          </Link>
        ))}
        <Link href="/history" className={`${card} hover:border-primary/40`}>
          <h2 className={h2}>Check-in/out history</h2>
          <p className="mt-1 text-sm text-muted-foreground">Every custody event, filterable by date, asset, holder and action.</p>
        </Link>
      </div>
    </>
  );
}
