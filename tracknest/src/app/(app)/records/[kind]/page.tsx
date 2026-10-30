import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { withOrg } from "@/db";
import { assetRecordLinks, assetRecords, assets, RECORD_KINDS, type RecordKind } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtMoney, isoDateIn } from "@/lib/format";
import { can } from "@/lib/permissions";
import { RECORD_LABEL } from "@/lib/records";
import { btn, card, h1, input, label, td, th } from "@/lib/ui";
import { addRecord } from "../actions";

export default async function RecordsPage({ params }: PageProps<"/records/[kind]">) {
  const user = await requireUser();
  const { kind: k } = await params;
  if (!(RECORD_KINDS as readonly string[]).includes(k)) notFound();
  const kind = k as RecordKind;
  const L = RECORD_LABEL[kind];
  const rows = await withOrg(user.orgId, (tx) =>
    tx
      .select({
        r: assetRecords,
        n: sql<number>`(count(${assets.id}) filter (where ${assets.deletedAt} is null))::int`,
        spent: sql<string | null>`sum(${assets.cost}) filter (where ${assets.deletedAt} is null)`,
      })
      .from(assetRecords)
      .leftJoin(assetRecordLinks, eq(assetRecordLinks.recordId, assetRecords.id))
      .leftJoin(assets, eq(assets.id, assetRecordLinks.assetId))
      .where(eq(assetRecords.kind, kind))
      .groupBy(assetRecords.id)
      .orderBy(asc(assetRecords.endDate), asc(assetRecords.name)),
  );
  const today = isoDateIn(new Date(), user.timezone);

  return (
    <>
      <h1 className={h1}>{L.many}</h1>
      <p className="-mt-4 text-sm text-muted-foreground">{L.help}</p>

      {can(user, "records") && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Add {L.one.toLowerCase()}</summary>
          <ActionForm action={addRecord.bind(null, kind)} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
            <label className={label}>
              Name
              <input name="name" required className={input} />
            </label>
            <label className={label}>
              {L.reference}
              <input name="reference" className={input} />
            </label>
            <label className={label}>
              {L.vendor}
              <input name="vendor" className={input} />
            </label>
            <label className={label}>
              {L.amount}
              <input name="amount" inputMode="decimal" className={input} />
            </label>
            <label className={label}>
              Starts
              <input name="startDate" type="date" className={input} />
            </label>
            <label className={label}>
              Ends
              <input name="endDate" type="date" className={input} />
            </label>
            <label className={label}>
              Notes
              <input name="notes" className={input} />
            </label>
            <button className={btn}>Add</button>
          </ActionForm>
        </details>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>{L.reference}</th>
              <th className={th}>{L.vendor}</th>
              <th className={th}>Ends</th>
              <th className={`${th} text-right`}>{L.amount}</th>
              <th className={`${th} text-right`}>Assets</th>
              {kind === "funding" && <th className={`${th} text-right`}>Spent on assets</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ r, n, spent }) => (
              <tr key={r.id}>
                <td className={td}>
                  <Link href={`/records/${kind}/${r.id}`} className="font-medium text-primary hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className={td}>{r.reference ?? "—"}</td>
                <td className={td}>{r.vendor ?? "—"}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {r.endDate ? fmtDate(r.endDate, "UTC") : "—"}
                  {r.endDate && r.endDate < today && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Ended</span>}
                </td>
                <td className={`${td} text-right`}>{fmtMoney(r.amount, user.currency)}</td>
                <td className={`${td} text-right`}>{n}</td>
                {kind === "funding" && <td className={`${td} text-right`}>{fmtMoney(spent ?? 0, user.currency)}</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className={`${td} text-muted-foreground`}>
                  Nothing yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
