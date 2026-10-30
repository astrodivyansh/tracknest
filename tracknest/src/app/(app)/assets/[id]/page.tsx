import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import bwipjs from "bwip-js/node";
import { withOrg } from "@/db";
import { assetEvents, assetFiles, assets, categories, assetRecordLinks, assetRecords, checkouts, customEvents, departments, locations, maintenance, reservations, sites, warranties } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { CONDITIONS } from "@/components/asset-form";
import { HolderSelect } from "@/components/holder-select";
import { MaintenanceList } from "@/components/maintenance-list";
import { ReservationList } from "@/components/reservation-list";
import { appOrigin, canEdit, requireUser } from "@/lib/auth";
import { can, disposalOn, featureOn, statusOn } from "@/lib/permissions";
import { DISPOSAL_LABEL, orgClock, STATUS_LABEL, STATUS_MOVES } from "@/lib/custody";
import { describeEvent, EVENT_LABEL, fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { appliesTo, showCustom } from "@/lib/custom-fields";
import { DEP_LABEL, depreciate } from "@/lib/depreciation";
import { getLookups } from "@/lib/lookups";
import { RECORD_LABEL } from "@/lib/records";
import { jobFields } from "@/lib/maintenance";
import { btn, btnSecondary, card, h1, h2, input, label, STATUS_BADGE } from "@/lib/ui";
import {
  changeStatusAction,
  checkInAction,
  checkOutAction,
  addWarrantyAction,
  disposeAction,
  duplicateAction,
  extendDueAction,
  linkAction,
  moveAction,
  recordCustomEventAction,
  removeWarrantyAction,
  unlinkAction,
  removeFileAction,
  uploadFilesAction,
} from "../actions";
import { scheduleAction } from "../../maintenance/actions";
import { reserveAction } from "../../reservations/actions";

export default async function AssetPage({ params }: PageProps<"/assets/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await withOrg(user.orgId, async (tx) => {
    const [asset] = await tx
      .select({
        a: assets,
        category: categories.name,
        rule: {
          depMethod: categories.depMethod,
          depLifeYears: categories.depLifeYears,
          depRatePct: categories.depRatePct,
          depSalvagePct: categories.depSalvagePct,
        },
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
        holderType: checkouts.holderType,
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
    const jobs = await tx
      .select(jobFields(user.timezone))
      .from(maintenance)
      .where(eq(maintenance.assetId, id))
      .orderBy(desc(maintenance.createdAt))
      .limit(50);
    const { today } = await orgClock(tx, user.orgId);
    const bookings = await tx
      .select()
      .from(reservations)
      .where(and(eq(reservations.assetId, id), eq(reservations.state, "active"), gte(reservations.endDate, today)))
      .orderBy(asc(reservations.startDate));
    const files = await tx.select().from(assetFiles).where(eq(assetFiles.assetId, id)).orderBy(asc(assetFiles.createdAt));
    const linkCols = { id: assets.id, tag: assets.tag, name: assets.name, status: assets.status };
    const [parent] = asset.a.parentId ? await tx.select(linkCols).from(assets).where(eq(assets.id, asset.a.parentId)) : [];
    const children = await tx
      .select(linkCols)
      .from(assets)
      .where(and(eq(assets.parentId, id), isNull(assets.deletedAt)))
      .orderBy(asc(assets.tag));
    const linkedRecords = await tx
      .select({ id: assetRecords.id, kind: assetRecords.kind, name: assetRecords.name, endDate: assetRecords.endDate })
      .from(assetRecordLinks)
      .innerJoin(assetRecords, eq(assetRecords.id, assetRecordLinks.recordId))
      .where(eq(assetRecordLinks.assetId, id))
      .orderBy(asc(assetRecords.kind), asc(assetRecords.name));
    const eventTypes = await tx.select({ id: customEvents.id, name: customEvents.name }).from(customEvents).orderBy(asc(customEvents.name));
    const warrantyRows = await tx.select().from(warranties).where(eq(warranties.assetId, id)).orderBy(desc(warranties.expiresOn));
    return { ...asset, open, events, jobs, today, bookings, files, parent, children, warranties: warrantyRows, customEvents: eventTypes, records: linkedRecords, lookups: await getLookups(tx) };
  });
  if (!data) notFound();
  const { a, open, events, jobs, lookups } = data;
  if (!can(user, "lease")) lookups.customers = []; // leasing off, or not allowed: no customers to check out to
  const inWorkshop = jobs.some((j) => j.state === "in_progress");
  const otherMoves = STATUS_MOVES[a.status].filter((m) => m.to !== "disposed" && statusOn(user, m.to)); // disposal has its own form
  const disposalMethods = (Object.keys(DISPOSAL_LABEL) as (keyof typeof DISPOSAL_LABEL)[]).filter((k) => disposalOn(user, k));
  const canDispose = disposalMethods.length > 0 && STATUS_MOVES[a.status].some((m) => m.to === "disposed");
  const tz = user.timezone;

  const origin = await appOrigin();
  const qr = bwipjs.toSVG({ bcid: "qrcode", text: `${origin}/a/${encodeURIComponent(a.tag)}`, scale: 3 });
  const overdue = open?.overdue;
  const dep = a.status === "disposed" ? null : depreciate(a, data.rule, new Date());

  const details: [string, React.ReactNode][] = [
    ["Category", data.category],
    [
      "Site / location",
      a.locationId ? (
        <Link href={`/locations/${a.locationId}`} className="text-primary hover:underline">
          {data.site} — {data.location}
        </Link>
      ) : (
        data.site
      ),
    ],
    [
      "Department",
      a.departmentId && (
        <Link href={`/departments/${a.departmentId}`} className="text-primary hover:underline">
          {data.department}
        </Link>
      ),
    ],
    ["Brand / model", [a.brand, a.model].filter(Boolean).join(" ")],
    ["Serial number", a.serial],
    ["Purchase date", a.purchaseDate && fmtDate(a.purchaseDate, tz)],
    ["Purchase cost", a.cost && fmtMoney(a.cost, user.currency)],
    ["Purchased from", a.purchasedFrom],
    [
      "Book value today",
      dep &&
        `${fmtMoney(dep.bookValue, user.currency)} · ${DEP_LABEL[data.rule!.depMethod]}, ${fmtMoney(dep.accumulated, user.currency)} depreciated`,
    ],
    ["Condition", a.condition],
    ...(a.disposedOn
      ? ([
          [
            "Disposed",
            `${DISPOSAL_LABEL[a.disposalMethod!]} on ${fmtDate(a.disposedOn, "UTC")}${a.disposalValue ? ` for ${fmtMoney(a.disposalValue, user.currency)}` : ""}`,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ...lookups.customFields
      .filter((f) => appliesTo(f, a.categoryId) || a.custom[f.id] !== undefined)
      .map((f): [string, React.ReactNode] => [f.label, showCustom(f, a.custom[f.id])]),
    ["Notes", a.notes],
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-muted-foreground">{a.tag}</p>
          <h1 className={h1}>{a.name}</h1>
          <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${STATUS_BADGE[a.status]}`}>
            {STATUS_LABEL[a.status]}
          </span>
        </div>
        {canEdit(user) && (
          <div className="flex items-start gap-2">
            {can(user, "edit") && (
              <Link href={`/assets/${a.id}/edit`} className={btnSecondary}>
                Edit
              </Link>
            )}
            <details className={`relative ${can(user, "add") ? "" : "hidden"}`}>
              <summary className={`${btnSecondary} cursor-pointer list-none`}>Duplicate</summary>
              <ActionForm action={duplicateAction.bind(null, a.id)} className="absolute right-0 z-10 mt-2 w-64 space-y-2 rounded-md border border-border bg-card p-3 shadow-md">
                <label className={label}>
                  How many copies
                  <input name="copies" type="number" min={1} max={50} defaultValue={1} required className={input} />
                </label>
                <p className="text-xs text-muted-foreground">Copies get new tags. Serial numbers, photos and history aren&apos;t copied.</p>
                <button className={btn}>Create copies</button>
              </ActionForm>
            </details>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
                <dd className="text-sm text-foreground">{v || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={`${card} flex flex-col items-center gap-2`}>
          {/* White in dark mode too, so it still scans from a screen. */}
          <div className="w-40 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="font-mono text-sm">{a.tag}</p>
          <p className="text-center text-xs text-muted-foreground">Scan with any phone camera to open this asset.</p>
        </section>
      </div>

      <section className={card}>
        <h2 className={h2}>Photos and documents</h2>
        {data.files.length === 0 && <p className="mt-2 text-sm text-muted-foreground">None yet. Add a photo, or the invoice or warranty card.</p>}
        {data.files.some((f) => f.kind === "photo") && (
          <ul className="mt-3 flex flex-wrap gap-3">
            {data.files
              .filter((f) => f.kind === "photo")
              .map((f) => (
                <li key={f.id} className="w-32">
                  <a href={`/files/${f.id}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file; the image optimiser can't fetch it */}
                    <img src={`/files/${f.id}`} alt={f.filename} className="h-32 w-32 rounded-md border border-border object-cover" />
                  </a>
                  {can(user, "edit") && (
                    <ActionForm action={removeFileAction.bind(null, a.id, f.id)}>
                      <button className="mt-1 text-xs text-red-600 dark:text-red-400 hover:underline">Remove</button>
                    </ActionForm>
                  )}
                </li>
              ))}
          </ul>
        )}
        {data.files.some((f) => f.kind === "document") && (
          <ul className="mt-3 divide-y divide-border text-sm">
            {data.files
              .filter((f) => f.kind === "document")
              .map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <a href={`/files/${f.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {f.filename}
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {f.size < 1024 ? `${f.size} bytes` : f.size < 1048576 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / 1048576).toFixed(1)} MB`} · {f.uploadedBy}, {fmtDate(f.createdAt, tz)}
                    </span>
                  </span>
                  <span className="flex gap-3">
                    <a href={`/files/${f.id}?download`} className="text-xs text-muted-foreground hover:underline">
                      Download
                    </a>
                    {can(user, "edit") && (
                      <ActionForm action={removeFileAction.bind(null, a.id, f.id)}>
                        <button className="text-xs text-red-600 dark:text-red-400 hover:underline">Remove</button>
                      </ActionForm>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        )}
        {can(user, "edit") && (
          <ActionForm action={uploadFilesAction.bind(null, a.id)} className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="file"
              name="files"
              multiple
              required
              accept="image/jpeg,image/png,image/webp,application/pdf"
              aria-label="Photos or PDF documents"
              className="text-sm"
            />
            <button className={btnSecondary}>Upload</button>
            <span className="text-xs text-muted-foreground">JPEG, PNG, WebP or PDF, up to 10 MB each</span>
          </ActionForm>
        )}
      </section>

      <section className={card}>
        <h2 className={h2}>Custody</h2>
        {open ? (
          <p className="mt-2 text-sm">
            {open.holderType === "customer" ? "Leased to" : "With"} <span className="font-semibold">{open.holderName}</span> since {fmtDateTime(open.checkedOutAt, tz)}
            {open.dueAt && <> · due {fmtDate(open.dueAt, tz)}</>}
            {overdue && <span className="ml-2 rounded bg-red-100 dark:bg-red-950/50 px-1.5 py-0.5 text-xs text-red-700 dark:text-red-400">Overdue</span>}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Not checked out.</p>
        )}

        {can(user, "checkout") && a.status === "available" && (
          <ActionForm action={checkOutAction.bind(null, a.id)} className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end">
            <label className={`${label} sm:col-span-2`}>
              Check out to
              <HolderSelect lookups={lookups} />
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

        {can(user, "checkout") && a.status === "checked_out" && (
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
        {can(user, "move") && a.status !== "disposed" && (
          <ActionForm action={moveAction.bind(null, a.id)} className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-4 sm:items-end">
            <label className={label}>
              Move to location
              <select name="locationId" defaultValue="" className={input}>
                <option value="">Keep current</option>
                {lookups.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.siteName} — {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Move to department
              <select name="departmentId" defaultValue="" className={input}>
                <option value="">Keep current</option>
                {lookups.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">Changes where it lives without checking it out.{data.children.length > 0 && " Linked assets move too."}</p>
            <button className={btnSecondary}>Move</button>
          </ActionForm>
        )}
        {can(user, "dispose") && otherMoves.length > 0 && !inWorkshop && (
          <ActionForm
            action={changeStatusAction.bind(null, a.id)}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-4 sm:items-end"
          >
            <label className={label}>
              Change status
              <select name="to" required defaultValue="" className={input}>
                <option value="" disabled>
                  Choose an action
                </option>
                {otherMoves.map((m) => (
                  <option key={m.to} value={m.to}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${label} sm:col-span-2`}>
              Reason
              <input name="reason" placeholder="e.g. screen cracked, left in cab" className={input} />
            </label>
            <button className={btnSecondary}>Update status</button>
          </ActionForm>
        )}
        {can(user, "dispose") && canDispose && !inWorkshop && (
          <details className="mt-4 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium text-red-700 dark:text-red-400">Dispose of this asset (sold, scrapped, donated, written off)</summary>
            <ActionForm action={disposeAction.bind(null, a.id)} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
              <label className={label}>
                How
                <select name="method" required defaultValue="" className={input}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {disposalMethods.map((k) => (
                    <option key={k} value={k}>
                      {DISPOSAL_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Date
                <input name="on" type="date" required max={data.today} defaultValue={data.today} className={input} />
              </label>
              <label className={label}>
                Sale or scrap value
                <input name="value" inputMode="decimal" placeholder="0.00" className={input} />
              </label>
              <label className={label}>
                Reason / buyer
                <input name="reason" required placeholder="e.g. sold to staff member" className={input} />
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-3">This is final. The asset&apos;s record and history are kept, and reports use the date and value.</p>
              <button className={btnSecondary}>Dispose</button>
            </ActionForm>
          </details>
        )}
        {a.status === "disposed" && <p className="mt-4 text-sm text-muted-foreground">This asset is disposed. Its record and history are kept.</p>}
      </section>

      {(featureOn(user, "link") || data.parent || data.children.length > 0) && (
        <section className={card}>
          <h2 className={h2}>Linked assets</h2>
          {data.parent && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              Part of
              <Link href={`/assets/${data.parent.id}`} className="font-mono text-primary hover:underline">
                {data.parent.tag}
              </Link>
              {data.parent.name}
              {can(user, "link") && (
                <ActionForm action={unlinkAction.bind(null, a.id)}>
                  <button className="text-sm text-red-600 hover:underline dark:text-red-400">Unlink</button>
                </ActionForm>
              )}
            </div>
          )}
          {data.children.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {data.children.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/assets/${c.id}`} className="font-mono text-primary hover:underline">
                    {c.tag}
                  </Link>
                  {c.name}
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                  {can(user, "link") && (
                    <ActionForm action={unlinkAction.bind(null, c.id)}>
                      <button className="text-sm text-red-600 hover:underline dark:text-red-400">Unlink</button>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!data.parent && data.children.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Not linked to other assets.</p>}
          {can(user, "link") && !data.parent && data.children.length === 0 && (
            <ActionForm action={linkAction.bind(null, a.id)} className="mt-3 flex flex-wrap items-end gap-2">
              <label className={label}>
                Make this part of asset (tag)
                <input name="parentTag" required placeholder="e.g. TN-000001" className={input} />
              </label>
              <button className={btnSecondary}>Link</button>
            </ActionForm>
          )}
        </section>
      )}

      {(featureOn(user, "warranty") || data.warranties.length > 0) && (
        <section className={card}>
          <h2 className={h2}>Warranties</h2>
          {data.warranties.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No warranties recorded.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {data.warranties.map((w) => {
                const expired = w.expiresOn < data.today;
                return (
                  <li key={w.id} className="flex flex-wrap items-center gap-2">
                    <span className={expired ? "text-muted-foreground line-through" : "font-medium"}>Until {fmtDate(w.expiresOn, "UTC")}</span>
                    {expired && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Expired</span>}
                    {[w.provider, w.lengthMonths && `${w.lengthMonths} months`, w.notes].filter(Boolean).join(" · ")}
                    {can(user, "warranty") && (
                      <ActionForm action={removeWarrantyAction.bind(null, a.id, w.id)}>
                        <button className="text-sm text-red-600 hover:underline dark:text-red-400">Remove</button>
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {can(user, "warranty") && a.status !== "disposed" && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-primary">Add a warranty</summary>
              <ActionForm action={addWarrantyAction.bind(null, a.id)} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
                <label className={label}>
                  Provider
                  <input name="provider" placeholder="e.g. Dell ProSupport" className={input} />
                </label>
                <label className={label}>
                  Ends on
                  <input name="expiresOn" type="date" className={input} />
                </label>
                <label className={label}>
                  or length (months)
                  <input name="lengthMonths" type="number" min={1} max={600} placeholder="from purchase date" className={input} />
                </label>
                <label className={label}>
                  Notes
                  <input name="notes" placeholder="e.g. on-site, next business day" className={input} />
                </label>
                <button className={`${btnSecondary} sm:col-start-4`}>Add warranty</button>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {data.records.length > 0 && (
        <section className={card}>
          <h2 className={h2}>Contracts, insurance and funding</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.records.map((r) => (
              <li key={r.id}>
                <span className="text-muted-foreground">{RECORD_LABEL[r.kind].one}:</span>{" "}
                <Link href={`/records/${r.kind}/${r.id}`} className="text-primary hover:underline">
                  {r.name}
                </Link>
                {r.endDate && ` · until ${fmtDate(r.endDate, "UTC")}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(featureOn(user, "reserve") || data.bookings.length > 0) && (
        <section className="space-y-2">
          <h2 className={h2}>Reservations</h2>
          <ReservationList rows={data.bookings} today={data.today} canEdit={can(user, "reserve")} />
          {can(user, "reserve") && a.status !== "disposed" && a.status !== "lost" && (
            <details className={card}>
              <summary className="cursor-pointer text-sm font-medium text-primary">Reserve this asset</summary>
              <ActionForm action={reserveAction.bind(null, a.id)} className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end">
                <label className={`${label} sm:col-span-2`}>
                  For
                  <HolderSelect lookups={lookups} />
                </label>
                <label className={label}>
                  From
                  <input name="startDate" type="date" required min={data.today} className={input} />
                </label>
                <label className={label}>
                  To
                  <input name="endDate" type="date" required min={data.today} className={input} />
                </label>
                <label className={`${label} sm:col-span-3`}>
                  Notes
                  <input name="notes" placeholder="e.g. for the annual day event" className={input} />
                </label>
                <button className={btn}>Reserve</button>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {(featureOn(user, "maintenance") || jobs.length > 0) && (
        <section className="space-y-2">
          <h2 className={h2}>Maintenance</h2>
          <MaintenanceList jobs={jobs} canEdit={can(user, "maintenance")} currency={user.currency} empty="No maintenance recorded." />
          {can(user, "maintenance") && a.status !== "disposed" && (
            <details className={card}>
              <summary className="cursor-pointer text-sm font-medium text-primary">Schedule maintenance</summary>
              <ActionForm action={scheduleAction.bind(null, a.id)} className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
                <label className={`${label} sm:col-span-2`}>
                  What needs doing
                  <input name="title" required placeholder="e.g. Annual service, replace battery" className={input} />
                </label>
                <label className={label}>
                  Type
                  <select name="kind" defaultValue="preventive" className={input}>
                    <option value="preventive">Preventive (routine)</option>
                    <option value="repair">Repair</option>
                  </select>
                </label>
                <label className={label}>
                  Due date
                  <input name="dueDate" type="date" className={input} />
                </label>
                <label className={label}>
                  Repeat
                  <select name="repeatMonths" defaultValue="0" className={input}>
                    <option value="0">Doesn’t repeat</option>
                    <option value="1">Every month</option>
                    <option value="3">Every 3 months</option>
                    <option value="6">Every 6 months</option>
                    <option value="12">Every year</option>
                  </select>
                </label>
                <label className={label}>
                  Vendor / technician
                  <input name="vendor" className={input} />
                </label>
                <label className={`${label} sm:col-span-2`}>
                  Notes
                  <input name="notes" className={input} />
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" name="startNow" /> Send for maintenance now
                </label>
                <button className={`${btn} sm:col-start-3`}>Save</button>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {can(user, "edit") && data.customEvents.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Record an event</summary>
          <ActionForm action={recordCustomEventAction.bind(null, a.id)} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
            <label className={label}>
              Event
              <select name="eventId" required defaultValue="" className={input}>
                <option value="" disabled>
                  Choose…
                </option>
                {data.customEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Date
              <input name="on" type="date" required max={data.today} defaultValue={data.today} className={input} />
            </label>
            <label className={label}>
              Notes
              <input name="notes" className={input} />
            </label>
            <button className={btnSecondary}>Record</button>
          </ActionForm>
        </details>
      )}

      <section className={card}>
        <h2 className={h2}>Custody and change history</h2>
        <p className="text-xs text-muted-foreground">Permanent record. Entries can&apos;t be edited or deleted.</p>
        <ol className="mt-4 space-y-3 border-l border-border pl-4">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-primary" />
              <p className="text-sm text-foreground">
                <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span> — {describeEvent(e, tz)}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtDateTime(e.occurredAt, tz)} · by {e.actorName} · via {e.source}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
