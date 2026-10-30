import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assetRecordLinks, assetRecords, assets, type RecordKind } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/custody";
import { fmtDate, fmtMoney } from "@/lib/format";
import { can } from "@/lib/permissions";
import { RECORD_LABEL } from "@/lib/records";
import { btnSecondary, card, h1, h2, input, label, STATUS_BADGE } from "@/lib/ui";
import { linkAssets, removeRecord, unlinkAsset, updateRecord } from "../../actions";

export default async function RecordPage({ params }: PageProps<"/records/[kind]/[id]">) {
  const user = await requireUser();
  const { kind, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withOrg(user.orgId, async (tx) => {
    const [r] = await tx
      .select()
      .from(assetRecords)
      .where(and(eq(assetRecords.id, id), eq(assetRecords.kind, kind as RecordKind)));
    if (!r) return null;
    const linked = await tx
      .select({ id: assets.id, tag: assets.tag, name: assets.name, status: assets.status, cost: assets.cost })
      .from(assetRecordLinks)
      .innerJoin(assets, eq(assets.id, assetRecordLinks.assetId))
      .where(and(eq(assetRecordLinks.recordId, id), isNull(assets.deletedAt)))
      .orderBy(asc(assets.tag));
    return { r, linked };
  });
  if (!data) notFound();
  const { r, linked } = data;
  const L = RECORD_LABEL[r.kind];
  const spent = linked.reduce((s, a) => s + Number(a.cost ?? 0), 0);
  const editable = can(user, "records");
  const text = (name: "name" | "reference" | "vendor" | "notes", title: string) => (
    <label className={label}>
      {title}
      <input name={name} required={name === "name"} defaultValue={r[name] ?? ""} className={input} />
    </label>
  );

  return (
    <>
      <div>
        <Link href={`/records/${r.kind}`} className="text-sm text-primary hover:underline">
          ← {L.many}
        </Link>
        <h1 className={h1}>{r.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[r.reference, r.vendor, r.startDate && `from ${fmtDate(r.startDate, "UTC")}`, r.endDate && `until ${fmtDate(r.endDate, "UTC")}`, r.amount && `${L.amount}: ${fmtMoney(r.amount, user.currency)}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {r.kind === "funding" && r.amount && (
          <p className="mt-1 text-sm">
            Spent on linked assets: <span className="font-medium">{fmtMoney(spent, user.currency)}</span> · Left:{" "}
            <span className="font-medium">{fmtMoney(Number(r.amount) - spent, user.currency)}</span>
          </p>
        )}
        {r.notes && <p className="mt-1 text-sm">{r.notes}</p>}
      </div>

      <section className={card}>
        <h2 className={h2}>Linked assets ({linked.length})</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {linked.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <Link href={`/assets/${a.id}`} className="font-mono text-primary hover:underline">
                {a.tag}
              </Link>
              {a.name}
              <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
              {editable && (
                <ActionForm action={unlinkAsset.bind(null, id, a.id)}>
                  <button className="text-sm text-red-600 hover:underline dark:text-red-400">Unlink</button>
                </ActionForm>
              )}
            </li>
          ))}
          {linked.length === 0 && <li className="text-muted-foreground">None yet.</li>}
        </ul>
        {editable && (
          <ActionForm action={linkAssets.bind(null, id)} className="mt-3 flex flex-wrap items-end gap-2">
            <label className={`${label} min-w-64 flex-1`}>
              Link assets by tag
              <input name="tags" required placeholder="TN-000001, TN-000002" className={input} />
            </label>
            <button className={btnSecondary}>Link</button>
          </ActionForm>
        )}
      </section>

      {editable && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Edit details</summary>
          <ActionForm action={updateRecord.bind(null, id)} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            {text("name", "Name")}
            {text("reference", L.reference)}
            {text("vendor", L.vendor)}
            <label className={label}>
              {L.amount}
              <input name="amount" inputMode="decimal" defaultValue={r.amount ?? ""} className={input} />
            </label>
            <label className={label}>
              Starts
              <input name="startDate" type="date" defaultValue={r.startDate ?? ""} className={input} />
            </label>
            <label className={label}>
              Ends
              <input name="endDate" type="date" defaultValue={r.endDate ?? ""} className={input} />
            </label>
            {text("notes", "Notes")}
            <button className={btnSecondary}>Save</button>
          </ActionForm>
          <ActionForm action={removeRecord.bind(null, r.kind, id)} className="mt-4 border-t border-border pt-3">
            <button className="text-sm text-red-600 hover:underline dark:text-red-400">Delete this {L.one.toLowerCase()} (asset histories keep a note)</button>
          </ActionForm>
        </details>
      )}
    </>
  );
}
