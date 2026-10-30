import Link from "next/link";
import { notFound } from "next/navigation";
import { withOrg } from "@/db";
import { REPORT_SCHEDULES } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { PrintButton } from "@/components/print-button";
import { canEdit, requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { fyBounds, fyLabel, REPORTS, runReport, totals, type Cell, type Column } from "@/lib/reports";
import { btn, btnSecondary, card, h1, input, label, td, th } from "@/lib/ui";
import { saveReport } from "../actions";

const SHOWN_ROWS = 1000;
const SCHEDULE_LABEL = { none: "Don't email it", daily: "Email it every day", weekly: "Email it every Monday", monthly: "Email it on the 1st of each month" };

export default async function ReportPage({ params, searchParams }: PageProps<"/reports/[slug]">) {
  const user = await requireUser();
  const { slug } = await params;
  const report = REPORTS.find((r) => r.slug === slug);
  if (!report) notFound();
  const sp = await searchParams;
  // One extra row tells us whether the screen view is cut off.
  const r = await withOrg(user.orgId, (tx) => runReport(tx, report, sp, user.timezone, SHOWN_ROWS + 1, user.fyStartMonth));
  const { columns, range, fiscal } = r;
  const cut = r.rows.length > SHOWN_ROWS;
  const shown = r.rows.slice(0, SHOWN_ROWS);
  const total = cut ? null : totals(columns, shown);
  const qs = r.params ? `?${r.params}` : "";
  // Each filter form resubmits the other parameters (chosen columns, dates) so they aren't lost.
  const keepParams = (...drop: string[]) =>
    [...new URLSearchParams(r.params)].filter(([k]) => !drop.includes(k)).map(([k, v], i) => <input key={i} type="hidden" name={k} value={v} />);

  const show = (c: Column, v: Cell) => {
    if (v === null || v === "") return "—";
    if (c.kind === "money") return fmtMoney(v as string | number, user.currency);
    if (c.kind === "date") return v instanceof Date ? fmtDate(v, user.timezone) : fmtDate(v as string, "UTC"); // plain dates have no time
    if (c.kind === "datetime") return fmtDateTime(v as Date, user.timezone);
    return String(v);
  };
  const right = (c: Column) => (c.kind === "money" || c.kind === "number" ? "text-right" : "");

  return (
    <>
      {/* Letterhead on paper only. */}
      <div className="hidden items-center gap-3 border-b pb-2 print:flex">
        {user.logoVersion && (
          // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file
          <img src={`/logo?v=${user.logoVersion}`} alt="" className="h-10 max-w-40 object-contain" />
        )}
        <span className="font-semibold">{user.orgName}</span>
        <span className="ml-auto text-xs">Printed {fmtDateTime(new Date(), user.timezone)}</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/reports" className="text-sm text-primary hover:underline print:hidden">
            ← Reports
          </Link>
          <h1 className={h1}>{report.title}</h1>
          <p className="text-sm text-muted-foreground">
            {report.description}
            {fiscal ? ` ${fyLabel(fiscal.fy, fiscal.startMonth)}.` : report.dateRange ? ` ${fmtDate(range.from, "UTC")} – ${fmtDate(range.to, "UTC")}.` : report.asOf ? ` As of ${fmtDate(range.to, "UTC")}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          <a href={`/reports/${report.slug}/export${qs}`} className={btn}>
            Download CSV
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        {report.dateRange && (
          <form className="flex flex-wrap items-end gap-3">
            {keepParams("from", "to")}
            <label className={label}>
              From
              <input type="date" name="from" defaultValue={range.from} className={input} />
            </label>
            <label className={label}>
              To
              <input type="date" name="to" defaultValue={range.to} className={input} />
            </label>
            <button className={btnSecondary}>Apply</button>
          </form>
        )}

        {fiscal && (
          <form className="flex flex-wrap items-end gap-3">
            {keepParams("fy")}
            <label className={label}>
              Financial year
              <select name="fy" defaultValue={fiscal.fy} className={input}>
                {Array.from({ length: 8 }, (_, i) => fiscal.current - i).map((y) => {
                  const b = fyBounds(y, fiscal.startMonth);
                  return (
                    <option key={y} value={y}>
                      {fyLabel(y, fiscal.startMonth)} ({fmtDate(b.from, "UTC")} – {fmtDate(b.to, "UTC")})
                    </option>
                  );
                })}
              </select>
            </label>
            <button className={btnSecondary}>Show</button>
          </form>
        )}

        {report.asOf && (
          <form className="flex flex-wrap items-end gap-3">
            {keepParams("to")}
            <label className={label}>
              As of
              <input type="date" name="to" defaultValue={range.to} className={input} />
            </label>
            <button className={btnSecondary}>Apply</button>
          </form>
        )}

        <details className="relative">
          <summary className={`${btnSecondary} cursor-pointer list-none`}>Columns ({columns.length} of {r.all.length})</summary>
          <form className="absolute z-10 mt-2 w-64 space-y-1 rounded-md border border-border bg-card p-3 shadow-md">
            {keepParams("col")}
            {r.all.map((c, i) => (
              <label key={c.label} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="col" value={i} defaultChecked={r.keep.includes(i)} /> {c.label}
              </label>
            ))}
            <button className={`${btn} mt-2 w-full`}>Show these columns</button>
          </form>
        </details>

        {canEdit(user) && (
          <details className="relative">
            <summary className={`${btnSecondary} cursor-pointer list-none`}>Save / schedule</summary>
            <ActionForm action={saveReport.bind(null, report.slug, r.params)} className={`${card} absolute z-10 mt-2 w-80 space-y-3 shadow-md`}>
              <label className={label}>
                Name
                <input name="name" required defaultValue={report.title} className={input} />
              </label>
              <label className={label}>
                Schedule
                <select name="schedule" defaultValue="none" className={input}>
                  {REPORT_SCHEDULES.map((s) => (
                    <option key={s} value={s}>
                      {SCHEDULE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Send to (emails)
                <textarea name="recipients" rows={2} placeholder="a@example.com, b@example.com" className={input} />
              </label>
              <p className="text-xs text-muted-foreground">Keeps these columns and filters. Scheduled reports arrive as a CSV after 8am.</p>
              <button className={btn}>Save report</button>
            </ActionForm>
          </details>
        )}
      </div>

      {cut && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Showing the first {SHOWN_ROWS.toLocaleString("en-IN")} rows. Download the CSV for everything.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((c) => (
                <th key={c.label} className={`${th} whitespace-nowrap ${right(c)}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r, i) => (
              <tr key={i}>
                {columns.map((c, j) => (
                  <td key={c.label} className={`${td} ${right(c)}`}>
                    {show(c, r[j])}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns.length} className={`${td} text-muted-foreground`}>
                  Nothing to show.
                </td>
              </tr>
            )}
          </tbody>
          {total && shown.length > 0 && (
            <tfoot className="border-t-2 border-border bg-muted/50 font-semibold">
              <tr>
                {columns.map((c, j) => (
                  <td key={c.label} className={`${td} ${right(c)}`}>
                    {j === 0 ? "Total" : total[j] !== null ? fmtMoney(total[j]!, user.currency) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
