import Link from "next/link";
import { asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assets } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { CONDITIONS } from "@/components/asset-form";
import { HolderSelect } from "@/components/holder-select";
import { requireUser } from "@/lib/auth";
import { DISPOSAL_LABEL, orgClock, STATUS_LABEL } from "@/lib/custody";
import { BULK, type BulkKind } from "@/lib/labels";
import { getLookups } from "@/lib/lookups";
import { can } from "@/lib/permissions";
import { btn, card, h1, input, label, STATUS_BADGE } from "@/lib/ui";
import { bulkAction } from "../actions";

/** "Select assets, then act": reached from the asset list with ?do=<action>&id=…&id=… */
export default async function BulkPage({ searchParams }: PageProps<"/assets/bulk">) {
  const user = await requireUser("manager");
  const sp = await searchParams;
  const kind = (typeof sp.do === "string" && sp.do in BULK ? sp.do : "checkout") as BulkKind;
  const ids = [sp.id ?? []].flat().filter((v) => z.uuid().safeParse(v).success).slice(0, 200);

  const { rows, lookups, today } = await withOrg(user.orgId, async (tx) => ({
    rows: ids.length
      ? await tx
          .select({ id: assets.id, tag: assets.tag, name: assets.name, status: assets.status })
          .from(assets)
          .where(inArray(assets.id, ids))
          .orderBy(asc(assets.tag))
      : [],
    lookups: await getLookups(tx),
    today: (await orgClock(tx, user.orgId)).today,
  }));
  if (!can(user, "lease")) lookups.customers = [];

  const locationSelect = (name: string, title: string, empty: string) => (
    <label className={label}>
      {title}
      <select name={name} defaultValue="" className={input}>
        <option value="">{empty}</option>
        {lookups.locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.siteName} — {l.name}
          </option>
        ))}
      </select>
    </label>
  );
  const conditionSelect = (title: string) => (
    <label className={label}>
      {title}
      <select name="condition" defaultValue="Good" className={input}>
        {CONDITIONS.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
  const notes = (
    <label className={`${label} sm:col-span-2`}>
      Notes
      <input name="notes" className={input} />
    </label>
  );

  const fields: Record<BulkKind, React.ReactNode> = {
    checkout: (
      <>
        <label className={`${label} sm:col-span-2`}>
          Check out to
          <HolderSelect lookups={lookups} />
        </label>
        <label className={label}>
          Due date
          <input name="dueDate" type="date" min={today} className={input} />
        </label>
        {conditionSelect("Condition")}
        {notes}
      </>
    ),
    checkin: (
      <>
        {locationSelect("returnLocationId", "Return to location", "Keep current")}
        {conditionSelect("Condition on return")}
        {notes}
      </>
    ),
    move: (
      <>
        {locationSelect("locationId", "Move to location", "Keep current")}
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
      </>
    ),
    maintenance: (
      <>
        <label className={`${label} sm:col-span-2`}>
          What needs doing
          <input name="title" required placeholder="e.g. Annual service" className={input} />
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
          Vendor / technician
          <input name="vendor" className={input} />
        </label>
        {notes}
      </>
    ),
    reserve: (
      <>
        <label className={`${label} sm:col-span-2`}>
          For
          <HolderSelect lookups={lookups} />
        </label>
        <label className={label}>
          From
          <input name="startDate" type="date" required min={today} className={input} />
        </label>
        <label className={label}>
          To
          <input name="endDate" type="date" required min={today} className={input} />
        </label>
        {notes}
      </>
    ),
    dispose: (
      <>
        <label className={label}>
          How
          <select name="method" required defaultValue="" className={input}>
            <option value="" disabled>
              Choose…
            </option>
            {Object.entries(DISPOSAL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Date
          <input name="on" type="date" required max={today} defaultValue={today} className={input} />
        </label>
        <label className={`${label} sm:col-span-2`}>
          Reason / buyer
          <input name="reason" required className={input} />
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-4">This is final. Records and history are kept. Set sale values one asset at a time.</p>
      </>
    ),
  };

  return (
    <>
      <div>
        <Link href="/assets" className="text-sm text-primary hover:underline">
          ← Assets
        </Link>
        <h1 className={h1}>
          {BULK[kind]} {rows.length} asset{rows.length === 1 ? "" : "s"}
        </h1>
        <p className="text-sm text-muted-foreground">All selected assets are done together. If one can&apos;t be, none are changed and you&apos;ll see why.</p>
      </div>
      <nav aria-label="Action" className="flex flex-wrap gap-2">
        {(Object.keys(BULK) as BulkKind[]).map((k) => (
          <Link
            key={k}
            href={`/assets/bulk?${new URLSearchParams([["do", k], ...ids.map((id) => ["id", id])])}`}
            aria-current={k === kind ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm ${k === kind ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
          >
            {BULK[k]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className={`${card} text-sm text-muted-foreground`}>
          No assets selected. <Link href="/assets" className="text-primary hover:underline">Pick some from the list.</Link>
        </p>
      ) : (
        <>
          <ul className={`${card} flex flex-wrap gap-2 text-sm`}>
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <span className="font-mono">{r.tag}</span> {r.name}
                <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
          <ActionForm key={kind} action={bulkAction.bind(null, kind, rows.map((r) => r.id))} className={`${card} grid gap-3 sm:grid-cols-4 sm:items-end`}>
            {fields[kind]}
            <button className={`${btn} sm:col-start-4`}>{BULK[kind]}</button>
          </ActionForm>
        </>
      )}
    </>
  );
}
