import Link from "next/link";
import { STATUS_LABEL } from "@/lib/labels";
import { STATUS_BADGE, td, th } from "@/lib/ui";

export type AssetListRow = { id: string; tag: string; name: string; status: string };

/** Compact asset table for the location and department pages. */
export function AssetList({ rows, empty }: { rows: AssetListRow[]; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/50">
          <tr>
            <th className={th}>Asset</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((a) => (
            <tr key={a.id}>
              <td className={td}>
                <Link href={`/assets/${a.id}`} className="font-mono text-primary hover:underline">
                  {a.tag}
                </Link>{" "}
                {a.name}
              </td>
              <td className={td}>
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={2} className={`${td} text-muted-foreground`}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
