import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { cancelAction, completeAction, startAction } from "@/app/(app)/maintenance/actions";
import { fmtDate, fmtMoney } from "@/lib/format";
import { btn, btnSecondary, input, label, td, th } from "@/lib/ui";

export type JobRow = {
  id: string;
  title: string;
  kind: string;
  state: string;
  dueDate: string | null;
  repeatMonths: number | null;
  vendor: string | null;
  cost: string | null;
  completionNotes: string | null;
  closedAt: Date | null;
  overdue: boolean;
  assetId?: string;
  assetTag?: string;
  assetName?: string;
};

const STATE_BADGE: Record<string, string> = {
  scheduled: "bg-muted text-foreground",
  in_progress: "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300",
  completed: "bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300",
  cancelled: "bg-muted text-muted-foreground",
};

/** Jobs table with inline start / complete / cancel actions. Dates are plain calendar days, shown as-is. */
export function MaintenanceList({
  jobs,
  canEdit,
  currency,
  showAsset,
  empty,
}: {
  jobs: JobRow[];
  canEdit: boolean;
  currency: string;
  showAsset?: boolean;
  empty: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/50">
          <tr>
            {showAsset && <th className={th}>Asset</th>}
            <th className={th}>Job</th>
            <th className={th}>Due</th>
            <th className={th}>Status</th>
            <th className={th}>Cost</th>
            {canEdit && <th className={th} />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((j) => (
            <tr key={j.id} className="align-top">
              {showAsset && (
                <td className={td}>
                  <Link href={`/assets/${j.assetId}`} className="font-mono text-primary hover:underline">
                    {j.assetTag}
                  </Link>{" "}
                  {j.assetName}
                </td>
              )}
              <td className={td}>
                <p className="font-medium">{j.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    j.kind === "repair" ? "Repair" : "Preventive",
                    j.repeatMonths && `every ${j.repeatMonths} month${j.repeatMonths === 1 ? "" : "s"}`,
                    j.vendor,
                    j.completionNotes && `“${j.completionNotes}”`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </td>
              <td className={`${td} whitespace-nowrap ${j.overdue ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
                {j.dueDate ? fmtDate(j.dueDate, "UTC") : "—"}
                {j.overdue && <span className="ml-1 text-xs">(overdue)</span>}
              </td>
              <td className={td}>
                <span className={`rounded px-2 py-0.5 text-xs ${STATE_BADGE[j.state]}`}>{j.state.replace("_", " ")}</span>
              </td>
              <td className={td}>{j.cost ? fmtMoney(j.cost, currency) : "—"}</td>
              {canEdit && (
                <td className={`${td} min-w-56`}>
                  <JobActions job={j} />
                </td>
              )}
            </tr>
          ))}
          {jobs.length === 0 && (
            <tr>
              <td colSpan={6} className={`${td} text-muted-foreground`}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function JobActions({ job }: { job: JobRow }) {
  if (job.state !== "scheduled" && job.state !== "in_progress") return null;
  return (
    <div className="space-y-2">
      {job.state === "scheduled" && (
        <ActionForm action={startAction.bind(null, job.id)}>
          <button className={`${btnSecondary} w-full`}>Start (send for maintenance)</button>
        </ActionForm>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-primary">Complete…</summary>
        <ActionForm action={completeAction.bind(null, job.id)} className="mt-2 space-y-2">
          <label className={label}>
            Cost
            <input name="cost" inputMode="decimal" placeholder="e.g. 1500" className={input} />
          </label>
          <label className={label}>
            What was done
            <input name="notes" className={input} />
          </label>
          {job.state === "in_progress" && (
            <label className={label}>
              Asset comes back
              <select name="result" defaultValue="available" className={input}>
                <option value="available">Working (available)</option>
                <option value="broken">Still broken</option>
              </select>
            </label>
          )}
          <button className={`${btn} w-full`}>Mark complete</button>
        </ActionForm>
      </details>
      {job.state === "scheduled" && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Cancel…</summary>
          <ActionForm action={cancelAction.bind(null, job.id)} className="mt-2 space-y-2">
            <input name="reason" placeholder="Reason (optional)" aria-label="Reason" className={input} />
            <button className={`${btnSecondary} w-full`}>Cancel job</button>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
