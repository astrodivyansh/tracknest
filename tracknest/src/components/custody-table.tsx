import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import { td, th } from "@/lib/ui";

export type CustodyRow = {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  holderName: string;
  checkedOutAt: Date;
  dueAt: Date | null;
  checkedInAt: Date | null;
  outCondition: string | null;
  inCondition: string | null;
  state: "open" | "returned";
  overdue: boolean; // computed by the database clock
};

/** Check-out periods (one row per hand-out), used on person, location and department pages. */
export function CustodyTable({ rows, tz, showHolder }: { rows: CustodyRow[]; tz: string; showHolder?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className={th}>Asset</th>
            {showHolder && <th className={th}>Held by</th>}
            <th className={th}>Checked out</th>
            <th className={th}>Due</th>
            <th className={th}>Checked in</th>
            <th className={th}>Condition out → in</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => {
            const overdue = r.overdue;
            return (
              <tr key={r.id}>
                <td className={td}>
                  <Link href={`/assets/${r.assetId}`} className="font-medium text-indigo-600 hover:underline">
                    {r.assetTag}
                  </Link>{" "}
                  {r.assetName}
                </td>
                {showHolder && <td className={td}>{r.holderName}</td>}
                <td className={td}>{fmtDateTime(r.checkedOutAt, tz)}</td>
                <td className={td}>
                  {fmtDateTime(r.dueAt, tz)}
                  {overdue && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">Overdue</span>}
                </td>
                <td className={td}>
                  {r.checkedInAt ? (
                    fmtDateTime(r.checkedInAt, tz)
                  ) : (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">Still out</span>
                  )}
                </td>
                <td className={td}>
                  {r.outCondition ?? "—"} → {r.inCondition ?? "—"}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className={`${td} text-gray-500`}>
                No check-outs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
