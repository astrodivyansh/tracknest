import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import bwipjs from "bwip-js/node";
import { withOrg } from "@/db";
import { assetEvents, assets, categories, checkouts, departments, locations, sites } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { CONDITIONS } from "@/components/asset-form";
import { canEdit, requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/custody";
import { describeEvent, EVENT_LABEL, fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { getLookups } from "@/lib/lookups";
import { btn, btnSecondary, card, h1, h2, input, label, STATUS_BADGE } from "@/lib/ui";
import { checkInAction, checkOutAction, extendDueAction } from "../actions";

export default async function AssetPage({ params }: PageProps<"/assets/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await withOrg(user.orgId, async (tx) => {
    const [asset] = await tx
      .select({
        a: assets,
        category: categories.name,
        location: locations.name,
        site: sites.name,
        department: departments.name,
      })
      .from(assets)
      .leftJoin(categories, eq(categories.id, assets.categoryId))
      .leftJoin(locations, eq(locations.id, assets.locationId))
      .leftJoin(sites, eq(sites.id, assets.siteId))
      .leftJoin(departments, eq(departments.id, assets.departmentId))
      .where(and(eq(assets.id, id), isNull(assets.deletedAt)));
    if (!asset) return null;
    const [open] = await tx
      .select({
        holderName: checkouts.holderName,
        checkedOutAt: checkouts.checkedOutAt,
        dueAt: checkouts.dueAt,
        overdue: sql<boolean>`${checkouts.dueAt} < now()`,
      })
      .from(checkouts)
      .where(and(eq(checkouts.assetId, id), eq(checkouts.state, "open")));
    const events = await tx
      .select()
      .from(assetEvents)
      .where(eq(assetEvents.assetId, id))
      .orderBy(desc(assetEvents.occurredAt))
      .limit(200);
    return { ...asset, open, events, lookups: await getLookups(tx) };
  });
  if (!data) notFound();
  const { a, open, events, lookups } = data;
  const tz = user.timezone;

  const h = await headers();
  const origin = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const qr = bwipjs.toSVG({ bcid: "qrcode", text: `${origin}/a/${encodeURIComponent(a.tag)}`, scale: 3 });
  const overdue = open?.overdue;

  const details: [string, React.ReactNode][] = [
    ["Category", data.category],
    ["Site / location", [data.site, data.location].filter(Boolean).join(" — ")],
    ["Department", data.department],
    ["Brand / model", [a.brand, a.model].filter(Boolean).join(" ")],
    ["Serial number", a.serial],
    ["Purchase date", a.purchaseDate && fmtDate(a.purchaseDate, tz)],
    ["Purchase cost", a.cost && fmtMoney(a.cost, user.currency)],
    ["Condition", a.condition],
    ["Notes", a.notes],
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-gray-500">{a.tag}</p>
          <h1 className={h1}>{a.name}</h1>
          <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${STATUS_BADGE[a.status]}`}>
            {STATUS_LABEL[a.status]}
          </span>
        </div>
        {canEdit(user) && (
          <Link href={`/assets/${a.id}/edit`} className={btnSecondary}>
            Edit
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-gray-500">{k}</dt>
                <dd className="text-sm text-gray-900">{v || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={`${card} flex flex-col items-center gap-2`}>
          <div className="w-40" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="font-mono text-sm">{a.tag}</p>
          <p className="text-center text-xs text-gray-500">Scan with any phone camera to open this asset.</p>
        </section>
      </div>

      <section className={card}>
        <h2 className={h2}>Custody</h2>
        {open ? (
          <p className="mt-2 text-sm">
            With <span className="font-semibold">{open.holderName}</span> since {fmtDateTime(open.checkedOutAt, tz)}
            {open.dueAt && <> · due {fmtDate(open.dueAt, tz)}</>}
            {overdue && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">Overdue</span>}
          </p>
        ) : (
          <p className="mt-2 text-sm text-gray-600">Not checked out.</p>
        )}

        {canEdit(user) && a.status === "available" && (
          <ActionForm action={checkOutAction.bind(null, a.id)} className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end">
            <label className={`${label} sm:col-span-2`}>
              Check out to
              <select name="holder" required defaultValue="" className={input}>
                <option value="" disabled>
                  Choose a person, location or department
                </option>
                <optgroup label="People">
                  {lookups.persons.map((p) => (
                    <option key={p.id} value={`person:${p.id}`}>
                      {p.name}
                      {p.employeeId ? ` (${p.employeeId})` : ""}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Locations">
                  {lookups.locations.map((l) => (
                    <option key={l.id} value={`location:${l.id}`}>
                      {l.siteName} — {l.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Departments">
                  {lookups.departments.map((d) => (
                    <option key={d.id} value={`department:${d.id}`}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className={label}>
              Due date
              <input name="dueDate" type="date" className={input} />
            </label>
            <label className={label}>
              Condition
              <select name="condition" defaultValue="Good" className={input}>
                {CONDITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className={`${label} sm:col-span-3`}>
              Notes
              <input name="notes" placeholder="e.g. with charger and bag" className={input} />
            </label>
            <button className={btn}>Check out</button>
          </ActionForm>
        )}

        {canEdit(user) && a.status === "checked_out" && (
          <div className="mt-4 space-y-4">
            <ActionForm action={checkInAction.bind(null, a.id)} className="grid gap-3 sm:grid-cols-4 sm:items-end">
              <label className={label}>
                Return to location
                <select name="returnLocationId" defaultValue={a.locationId ?? ""} className={input}>
                  <option value="">Keep current</option>
                  {lookups.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.siteName} — {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Condition on return
                <select name="condition" defaultValue="Good" className={input}>
                  {CONDITIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Notes
                <input name="notes" className={input} />
              </label>
              <button className={btn}>Check in</button>
            </ActionForm>
            <ActionForm action={extendDueAction.bind(null, a.id)} className="flex flex-wrap items-end gap-3">
              <label className={label}>
                Change due date
                <input name="dueDate" type="date" required className={input} />
              </label>
              <button className={btnSecondary}>Update due date</button>
            </ActionForm>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className={h2}>Custody and change history</h2>
        <p className="text-xs text-gray-500">Permanent record. Entries can&apos;t be edited or deleted.</p>
        <ol className="mt-4 space-y-3 border-l border-gray-200 pl-4">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-indigo-500" />
              <p className="text-sm text-gray-900">
                <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span> — {describeEvent(e, tz)}
              </p>
              <p className="text-xs text-gray-500">
                {fmtDateTime(e.occurredAt, tz)} · by {e.actorName} · via {e.source}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
