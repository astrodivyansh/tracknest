import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { cancelReservationAction } from "@/app/(app)/reservations/actions";
import { fmtDate } from "@/lib/format";
import { btnSecondary, input, td, th } from "@/lib/ui";

export type ReservationRow = {
  id: string;
  holderName: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  createdBy: string;
  assetId?: string;
  assetTag?: string;
  assetName?: string;
};

const day = (d: string) => fmtDate(d, "UTC"); // plain calendar dates

/** Upcoming active reservations, with a cancel action for managers. */
export function ReservationList({
  rows,
  today,
  canEdit,
  showAsset,
}: {
  rows: ReservationRow[];
  today: string;
  canEdit: boolean;
  showAsset?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/50">
          <tr>
            {showAsset && <th className={th}>Asset</th>}
            <th className={th}>For</th>
            <th className={th}>Dates</th>
            <th className={th}>Notes</th>
            {canEdit && <th className={th} />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              {showAsset && (
                <td className={td}>
                  <Link href={`/assets/${r.assetId}`} className="font-mono text-primary hover:underline">
                    {r.assetTag}
                  </Link>{" "}
                  {r.assetName}
                </td>
              )}
              <td className={td}>{r.holderName}</td>
              <td className={`${td} whitespace-nowrap`}>
                {day(r.startDate)} – {day(r.endDate)}
                {r.startDate <= today && (
                  <span className="ml-2 rounded bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">
                    {r.startDate === today ? "Starts today" : "Not picked up"}
                  </span>
                )}
              </td>
              <td className={td}>
                {r.notes ?? "—"}
                <p className="text-xs text-muted-foreground">by {r.createdBy}</p>
              </td>
              {canEdit && (
                <td className={td}>
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">Cancel…</summary>
                    <ActionForm action={cancelReservationAction.bind(null, r.id)} className="mt-2 flex gap-2">
                      <input name="reason" placeholder="Reason (optional)" aria-label="Reason" className={input} />
                      <button className={btnSecondary}>Cancel</button>
                    </ActionForm>
                  </details>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className={`${td} text-muted-foreground`}>
                No upcoming reservations.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
