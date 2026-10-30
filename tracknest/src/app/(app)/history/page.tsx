import Link from "next/link";
import { withOrg } from "@/db";
import { EVENT_TYPES } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { describeEvent, EVENT_LABEL, fmtDateTime } from "@/lib/format";
import { listEvents, parseFilters } from "@/lib/history";
import { btnSecondary, h1, input, label, td, th } from "@/lib/ui";

const PAGE_LIMIT = 300;

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const user = await requireUser();
  const f = parseFilters(await searchParams);
  const rows = await withOrg(user.orgId, (tx) => listEvents(tx, f, user.timezone, PAGE_LIMIT));
  const exportHref = `/history/export?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={h1}>Check-in / check-out history</h1>
          <p className="text-sm text-muted-foreground">Every custody change and edit across your organization. Permanent and read-only.</p>
        </div>
        <a href={exportHref} className={btnSecondary}>
          Export CSV
        </a>
      </div>

      <form className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-6 sm:items-end">
        <label className={label}>
          From
          <input type="date" name="from" defaultValue={f.from} className={input} />
        </label>
        <label className={label}>
          To
          <input type="date" name="to" defaultValue={f.to} className={input} />
        </label>
        <label className={label}>
          Action
          <select name="type" defaultValue={f.type} className={input}>
            <option value="">All</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Asset
          <input name="q" defaultValue={f.q} placeholder="Tag or name" className={input} />
        </label>
        <label className={label}>
          Holder
          <input name="holder" defaultValue={f.holder} placeholder="Person or place" className={input} />
        </label>
        <button className={btnSecondary}>Apply</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>When</th>
              <th className={th}>Asset</th>
              <th className={th}>Action</th>
              <th className={th}>Details</th>
              <th className={th}>By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((e) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap`}>{fmtDateTime(e.occurredAt, user.timezone)}</td>
                <td className={td}>
                  <Link href={`/assets/${e.assetId}`} className="font-mono text-primary hover:underline">
                    {e.assetTag}
                  </Link>{" "}
                  {e.assetName}
                </td>
                <td className={`${td} whitespace-nowrap`}>{EVENT_LABEL[e.type]}</td>
                <td className={td}>{describeEvent(e, user.timezone)}</td>
                <td className={`${td} whitespace-nowrap`}>{e.actorName}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={`${td} text-muted-foreground`}>
                  No history matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length === PAGE_LIMIT && (
        <p className="text-sm text-muted-foreground">Showing the latest {PAGE_LIMIT}. Narrow the dates or export CSV for everything.</p>
      )}
    </>
  );
}
