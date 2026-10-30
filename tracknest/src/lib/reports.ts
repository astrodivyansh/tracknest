import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, sum, type SQL } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  assetEvents,
  assets,
  auditItems,
  audits,
  categories,
  checkouts,
  customFields,
  departments,
  locations,
  maintenance,
  reservations,
  sites,
  warranties,
  type AssetStatus,
} from "@/db/schema";
import { DISPOSAL_LABEL, STATUS_LABEL } from "./custody";
import { DEP_LABEL, depreciate, type DepRule } from "./depreciation";
import { describeEvent, endOfDayIn, isoDateIn, startOfDayIn } from "./format";

/** How a column is shown on screen and written to CSV. Money columns get a total row. */
export type Column = { label: string; kind?: "text" | "number" | "money" | "date" | "datetime" };
export type Cell = string | number | Date | null;
type Ctx = { tz: string; from: string; to: string };

export type Report = {
  slug: string;
  title: string;
  description: string;
  dateRange?: boolean; // shows from/to inputs; other reports ignore them
  asOf?: boolean; // shows one "as of" date input, passed as `to`
  fiscalYear?: boolean; // shows a financial-year picker (the org's financial year), passed as from/to
  columns: Column[];
  /** Columns that depend on the org's setup (custom fields); defaults to `columns`. */
  columnsFor?: (tx: Tx) => Promise<Column[]>;
  run: (tx: Tx, ctx: Ctx, limit: number) => Promise<Cell[][]>;
};

const live = isNull(assets.deletedAt);

const fieldDefs = (tx: Tx) =>
  tx.select({ id: customFields.id, label: customFields.label, type: customFields.type }).from(customFields).orderBy(asc(customFields.createdAt));

/** Custom value as a report cell: dates stay YYYY-MM-DD, yes/no becomes text. */
const customCell = (type: string, v: unknown): Cell =>
  v === undefined || v === null ? null : type === "checkbox" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : (v as string | number);

const REGISTER_COLUMNS: Column[] = [
  { label: "Tag" }, { label: "Name" }, { label: "Category" }, { label: "Brand" }, { label: "Model" },
  { label: "Serial" }, { label: "Site" }, { label: "Location" }, { label: "Department" }, { label: "Status" },
  { label: "Held by" }, { label: "Condition" }, { label: "Purchase date", kind: "date" }, { label: "Cost", kind: "money" },
];

export const REPORTS: Report[] = [
  {
    slug: "asset-register",
    title: "Asset register",
    description: "Every asset with its details, place, status, holder and purchase value.",
    columns: REGISTER_COLUMNS,
    columnsFor: async (tx) => [
      ...REGISTER_COLUMNS,
      ...(await fieldDefs(tx)).map((d): Column => ({ label: d.label, kind: d.type === "date" ? "date" : d.type === "number" ? "number" : d.type === "currency" ? "money" : "text" })),
    ],
    run: async (tx, _ctx, limit) => {
      const defs = await fieldDefs(tx);
      return (
        await tx
          .select({
            tag: assets.tag, name: assets.name, category: categories.name, brand: assets.brand, model: assets.model,
            serial: assets.serial, site: sites.name, location: locations.name, department: departments.name,
            status: assets.status, holder: checkouts.holderName, condition: assets.condition,
            purchaseDate: assets.purchaseDate, cost: assets.cost, custom: assets.custom,
          })
          .from(assets)
          .leftJoin(categories, eq(categories.id, assets.categoryId))
          .leftJoin(sites, eq(sites.id, assets.siteId))
          .leftJoin(locations, eq(locations.id, assets.locationId))
          .leftJoin(departments, eq(departments.id, assets.departmentId))
          .leftJoin(checkouts, and(eq(checkouts.assetId, assets.id), eq(checkouts.state, "open")))
          .where(live)
          .orderBy(asc(assets.tag))
          .limit(limit)
      ).map((r) => [
        r.tag, r.name, r.category, r.brand, r.model, r.serial, r.site, r.location, r.department,
        STATUS_LABEL[r.status], r.holder, r.condition, r.purchaseDate, r.cost,
        ...defs.map((d) => customCell(d.type, r.custom[d.id])),
      ]);
    },
  },
  {
    slug: "checked-out",
    title: "Assets out, by holder",
    description: "Everything currently checked out, grouped by the person, location or department holding it.",
    columns: [
      { label: "Held by" }, { label: "Holder type" }, { label: "Tag" }, { label: "Name" },
      { label: "Out since", kind: "datetime" }, { label: "Due", kind: "date" }, { label: "Overdue" },
    ],
    run: async (tx, _ctx, limit) =>
      (
        await tx
          .select({
            holder: checkouts.holderName, type: checkouts.holderType, tag: assets.tag, name: assets.name,
            out: checkouts.checkedOutAt, due: checkouts.dueAt, overdue: sql<boolean>`coalesce(${checkouts.dueAt} < now(), false)`,
          })
          .from(checkouts)
          .innerJoin(assets, eq(assets.id, checkouts.assetId))
          .where(eq(checkouts.state, "open"))
          .orderBy(asc(checkouts.holderName), asc(assets.tag))
          .limit(limit)
      ).map((r) => [r.holder, r.type, r.tag, r.name, r.out, r.due, r.overdue ? "Yes" : ""]),
  },
  {
    slug: "overdue",
    title: "Overdue returns",
    description: "Checked-out assets past their due date, longest overdue first.",
    columns: [
      { label: "Tag" }, { label: "Name" }, { label: "Held by" }, { label: "Due", kind: "date" },
      { label: "Days overdue", kind: "number" },
    ],
    run: async (tx, _ctx, limit) =>
      (
        await tx
          .select({
            tag: assets.tag, name: assets.name, holder: checkouts.holderName, due: checkouts.dueAt,
            days: sql<number>`floor(extract(epoch from now() - ${checkouts.dueAt}) / 86400)::int`,
          })
          .from(checkouts)
          .innerJoin(assets, eq(assets.id, checkouts.assetId))
          .where(and(eq(checkouts.state, "open"), sql`${checkouts.dueAt} < now()`))
          .orderBy(asc(checkouts.dueAt))
          .limit(limit)
      ).map((r) => [r.tag, r.name, r.holder, r.due, r.days]),
  },
  {
    slug: "by-location",
    title: "Assets by location",
    description: "How many assets each site and location has, and their total purchase value.",
    columns: [{ label: "Site" }, { label: "Location" }, { label: "Assets", kind: "number" }, { label: "Total cost", kind: "money" }],
    run: async (tx, _ctx, limit) =>
      (
        await tx
          .select({ site: sites.name, location: locations.name, n: count(), total: sum(assets.cost) })
          .from(assets)
          .leftJoin(sites, eq(sites.id, assets.siteId))
          .leftJoin(locations, eq(locations.id, assets.locationId))
          .where(and(live, sql`${assets.status} <> 'disposed'`))
          .groupBy(sites.name, locations.name)
          .orderBy(sql`${sites.name} nulls last`, sql`${locations.name} nulls last`)
          .limit(limit)
      ).map((r) => [r.site ?? "No site", r.location ?? "No location", r.n, r.total]),
  },
  {
    slug: "by-category",
    title: "Assets by category",
    description: "Count by status and total purchase value for each category (disposed assets excluded).",
    columns: [
      { label: "Category" }, { label: "Assets", kind: "number" }, { label: "Available", kind: "number" },
      { label: "Checked out", kind: "number" }, { label: "Maintenance / broken / lost", kind: "number" },
      { label: "Total cost", kind: "money" },
    ],
    run: async (tx, _ctx, limit) => {
      const n = (statuses: AssetStatus[]) => sql<number>`(count(*) filter (where ${inArray(assets.status, statuses)}))::int`;
      return (
        await tx
          .select({
            category: categories.name, total: count(),
            available: n(["available"]), out: n(["checked_out"]), other: n(["under_maintenance", "broken", "lost"]),
            cost: sum(assets.cost),
          })
          .from(assets)
          .leftJoin(categories, eq(categories.id, assets.categoryId))
          .where(and(live, sql`${assets.status} <> 'disposed'`))
          .groupBy(categories.name)
          .orderBy(desc(count()))
          .limit(limit)
      ).map((r) => [r.category ?? "Uncategorised", r.total, r.available, r.out, r.other, r.cost]);
    },
  },
  {
    slug: "maintenance-cost",
    title: "Maintenance cost",
    description: "Completed maintenance jobs and what they cost, in a date range.",
    dateRange: true,
    columns: [
      { label: "Completed", kind: "date" }, { label: "Tag" }, { label: "Name" }, { label: "Job" },
      { label: "Type" }, { label: "Vendor" }, { label: "Cost", kind: "money" },
    ],
    run: async (tx, { tz, from, to }, limit) =>
      (
        await tx
          .select({
            closed: maintenance.closedAt, tag: assets.tag, name: assets.name, title: maintenance.title,
            kind: maintenance.kind, vendor: maintenance.vendor, cost: maintenance.cost,
          })
          .from(maintenance)
          .innerJoin(assets, eq(assets.id, maintenance.assetId))
          .where(
            and(
              eq(maintenance.state, "completed"),
              gte(maintenance.closedAt, startOfDayIn(from, tz)),
              lte(maintenance.closedAt, endOfDayIn(to, tz)),
            ),
          )
          .orderBy(desc(maintenance.closedAt))
          .limit(limit)
      ).map((r) => [r.closed, r.tag, r.name, r.title, r.kind === "repair" ? "Repair" : "Preventive", r.vendor, r.cost]),
  },
  {
    slug: "depreciation",
    title: "Depreciation and book value",
    description: "Cost, depreciation to date and book value of every asset, using each category's rule.",
    asOf: true,
    columns: [
      { label: "Tag" }, { label: "Name" }, { label: "Category" }, { label: "Method" },
      { label: "Purchase date", kind: "date" }, { label: "Cost", kind: "money" },
      { label: "Depreciated to date", kind: "money" }, { label: "Book value", kind: "money" },
    ],
    run: async (tx, { tz, to }, limit) => {
      const asOf = endOfDayIn(to, tz);
      const held = await depreciable(tx, limit, sql`(${assets.disposedOn} is null or ${assets.disposedOn} > ${to})`);
      return held.map((r) => {
        const d = depreciate(r, r.rule, asOf);
        return [r.tag, r.name, r.category, methodLabel(r.rule, d), r.purchaseDate, r.cost, d?.accumulated ?? 0, d?.bookValue ?? Number(r.cost)];
      });
    },
  },
  {
    slug: "depreciation-schedule",
    title: "Depreciation schedule (financial year)",
    description: "For a financial year: opening value, additions, depreciation for the year and closing value of each asset.",
    fiscalYear: true,
    columns: [
      { label: "Tag" }, { label: "Name" }, { label: "Category" }, { label: "Method" }, { label: "Purchase date", kind: "date" },
      { label: "Opening value", kind: "money" }, { label: "Additions", kind: "money" },
      { label: "Depreciation for the year", kind: "money" }, { label: "Disposals", kind: "money" }, { label: "Closing value", kind: "money" },
    ],
    run: async (tx, { tz, from, to }, limit) => {
      const [start, end] = [startOfDayIn(from, tz), endOfDayIn(to, tz)];
      // Not in this year's schedule: bought after it, or disposed before it.
      const inYear = sql`(${assets.purchaseDate} is null or ${assets.purchaseDate} <= ${to}) and (${assets.disposedOn} is null or ${assets.disposedOn} >= ${from})`;
      return (await depreciable(tx, limit, inYear)).map((r) => {
        const cost = Number(r.cost);
        const boughtThisYear = !!r.purchaseDate && r.purchaseDate >= from;
        const disposedThisYear = !!r.disposedOn && r.disposedOn <= to;
        const opening = boughtThisYear ? 0 : (depreciate(r, r.rule, start)?.bookValue ?? cost);
        const additions = boughtThisYear ? cost : 0;
        // Depreciation runs until the disposal day; the remaining book value leaves as a disposal.
        const lastDay = disposedThisYear ? endOfDayIn(r.disposedOn!, tz) : end;
        const bookAtEnd = depreciate(r, r.rule, lastDay)?.bookValue ?? cost;
        const disposals = disposedThisYear ? bookAtEnd : 0;
        const closing = disposedThisYear ? 0 : bookAtEnd;
        const forYear = Math.round((opening + additions - bookAtEnd) * 100) / 100;
        const method = methodLabel(r.rule, depreciate(r, r.rule, lastDay));
        return [r.tag, r.name, r.category, method, r.purchaseDate, opening, additions, forYear, disposals, closing];
      });
    },
  },
  {
    slug: "disposals",
    title: "Disposals",
    description: "Assets sold, scrapped, donated or written off in a date range, with book value at disposal and gain or loss.",
    dateRange: true,
    columns: [
      { label: "Disposed on", kind: "date" }, { label: "Tag" }, { label: "Name" }, { label: "Category" }, { label: "How" },
      { label: "Cost", kind: "money" }, { label: "Book value at disposal", kind: "money" },
      { label: "Sale / scrap value", kind: "money" }, { label: "Gain / (loss)", kind: "money" },
    ],
    run: async (tx, { tz, from, to }, limit) =>
      (await depreciable(tx, limit, sql`${assets.disposedOn} between ${from} and ${to}`, desc(assets.disposedOn))).map((r) => {
        const book = depreciate(r, r.rule, endOfDayIn(r.disposedOn!, tz))?.bookValue ?? Number(r.cost);
        const proceeds = Number(r.disposalValue ?? 0);
        return [
          r.disposedOn, r.tag, r.name, r.category, DISPOSAL_LABEL[r.disposalMethod!], r.cost, book, proceeds,
          Math.round((proceeds - book) * 100) / 100,
        ];
      }),
  },
  {
    slug: "by-status",
    title: "Assets by status",
    description: "How many assets are available, checked out, in maintenance, broken, lost or disposed, and their purchase value.",
    columns: [{ label: "Status" }, { label: "Assets", kind: "number" }, { label: "Total cost", kind: "money" }],
    run: async (tx, _ctx, limit) =>
      (
        await tx
          .select({ status: assets.status, n: count(), total: sum(assets.cost) })
          .from(assets)
          .where(live)
          .groupBy(assets.status)
          .orderBy(desc(count()))
          .limit(limit)
      ).map((r) => [STATUS_LABEL[r.status], r.n, r.total]),
  },
  {
    slug: "by-department",
    title: "Assets by department",
    description: "How many assets each department has, and their total purchase value.",
    columns: [{ label: "Department" }, { label: "Assets", kind: "number" }, { label: "Total cost", kind: "money" }],
    run: async (tx, _ctx, limit) =>
      (
        await tx
          .select({ department: departments.name, n: count(), total: sum(assets.cost) })
          .from(assets)
          .leftJoin(departments, eq(departments.id, assets.departmentId))
          .where(and(live, sql`${assets.status} <> 'disposed'`))
          .groupBy(departments.name)
          .orderBy(sql`${departments.name} nulls last`)
          .limit(limit)
      ).map((r) => [r.department ?? "No department", r.n, r.total]),
  },
  {
    slug: "leased",
    title: "Leased assets, by customer",
    description: "Everything currently leased out, grouped by customer, with due dates.",
    columns: [{ label: "Customer" }, { label: "Tag" }, { label: "Name" }, { label: "Leased since", kind: "datetime" }, { label: "Due", kind: "date" }, { label: "Overdue" }],
    run: async (tx, _ctx, limit) =>
      (
        await tx
          .select({
            holder: checkouts.holderName, tag: assets.tag, name: assets.name, out: checkouts.checkedOutAt, due: checkouts.dueAt,
            overdue: sql<boolean>`coalesce(${checkouts.dueAt} < now(), false)`,
          })
          .from(checkouts)
          .innerJoin(assets, eq(assets.id, checkouts.assetId))
          .where(and(eq(checkouts.state, "open"), eq(checkouts.holderType, "customer")))
          .orderBy(asc(checkouts.holderName), asc(assets.tag))
          .limit(limit)
      ).map((r) => [r.holder, r.tag, r.name, r.out, r.due, r.overdue ? "Yes" : ""]),
  },
  {
    slug: "warranties",
    title: "Warranties",
    description: "Every recorded warranty, soonest ending first, with days left (negative once expired).",
    columns: [{ label: "Ends", kind: "date" }, { label: "Days left", kind: "number" }, { label: "Tag" }, { label: "Name" }, { label: "Provider" }, { label: "Notes" }],
    run: async (tx, { tz }, limit) =>
      (
        await tx
          .select({
            ends: warranties.expiresOn, left: sql<number>`(${warranties.expiresOn} - (now() at time zone ${tz})::date)::int`,
            tag: assets.tag, name: assets.name, provider: warranties.provider, notes: warranties.notes,
          })
          .from(warranties)
          .innerJoin(assets, eq(assets.id, warranties.assetId))
          .where(and(live, sql`${assets.status} <> 'disposed'`))
          .orderBy(asc(warranties.expiresOn))
          .limit(limit)
      ).map((r) => [r.ends, r.left, r.tag, r.name, r.provider, r.notes]),
  },
  {
    slug: "maintenance-due",
    title: "Maintenance due",
    description: "Scheduled maintenance not yet started, by due date, with overdue jobs flagged.",
    columns: [{ label: "Due", kind: "date" }, { label: "Tag" }, { label: "Name" }, { label: "Job" }, { label: "Type" }, { label: "Vendor" }, { label: "Overdue" }],
    run: async (tx, { tz }, limit) =>
      (
        await tx
          .select({
            due: maintenance.dueDate, tag: assets.tag, name: assets.name, title: maintenance.title, kind: maintenance.kind, vendor: maintenance.vendor,
            overdue: sql<boolean>`coalesce(${maintenance.dueDate} < (now() at time zone ${tz})::date, false)`,
          })
          .from(maintenance)
          .innerJoin(assets, eq(assets.id, maintenance.assetId))
          .where(eq(maintenance.state, "scheduled"))
          .orderBy(sql`${maintenance.dueDate} nulls last`, asc(assets.tag))
          .limit(limit)
      ).map((r) => [r.due, r.tag, r.name, r.title, r.kind, r.vendor, r.overdue ? "Yes" : ""]),
  },
  {
    slug: "reservations",
    title: "Upcoming reservations",
    description: "Active bookings that haven't ended, by start date.",
    columns: [{ label: "From", kind: "date" }, { label: "To", kind: "date" }, { label: "Tag" }, { label: "Name" }, { label: "For" }, { label: "Notes" }],
    run: async (tx, { tz }, limit) =>
      (
        await tx
          .select({ from: reservations.startDate, to: reservations.endDate, tag: assets.tag, name: assets.name, holder: reservations.holderName, notes: reservations.notes })
          .from(reservations)
          .innerJoin(assets, eq(assets.id, reservations.assetId))
          .where(and(eq(reservations.state, "active"), sql`${reservations.endDate} >= (now() at time zone ${tz})::date`))
          .orderBy(asc(reservations.startDate), asc(assets.tag))
          .limit(limit)
      ).map((r) => [r.from, r.to, r.tag, r.name, r.holder, r.notes]),
  },
  {
    slug: "moves",
    title: "Moves and status changes",
    description: "Assets moved between locations or departments, or whose status changed, in a date range.",
    dateRange: true,
    columns: [{ label: "When", kind: "datetime" }, { label: "Tag" }, { label: "Name" }, { label: "What changed" }, { label: "By" }],
    run: async (tx, { tz, from, to }, limit) =>
      (
        await tx
          .select({ e: assetEvents, tag: assets.tag, name: assets.name })
          .from(assetEvents)
          .innerJoin(assets, eq(assets.id, assetEvents.assetId))
          .where(
            and(
              inArray(assetEvents.type, ["moved", "status_changed"]),
              gte(assetEvents.occurredAt, startOfDayIn(from, tz)),
              lte(assetEvents.occurredAt, endOfDayIn(to, tz)),
            ),
          )
          .orderBy(desc(assetEvents.occurredAt))
          .limit(limit)
      ).map((r) => [r.e.occurredAt, r.tag, r.name, describeEvent(r.e, tz), r.e.actorName]),
  },
  {
    slug: "audits",
    title: "Audit results",
    description: "Every audit with how many assets were expected, found, missing and found unexpectedly.",
    columns: [
      { label: "Started", kind: "datetime" }, { label: "Audit" }, { label: "State" }, { label: "Expected", kind: "number" },
      { label: "Found", kind: "number" }, { label: "Missing", kind: "number" }, { label: "Unexpected", kind: "number" },
      { label: "Closed", kind: "datetime" }, { label: "By" },
    ],
    run: async (tx, _ctx, limit) => {
      const n = (cond: SQL) => sql<number>`(select count(*) from ${auditItems} where ${auditItems.auditId} = ${audits.id} and ${cond})::int`;
      return (
        await tx
          .select({
            started: audits.createdAt, name: audits.name, state: audits.state,
            expected: n(sql`${auditItems.expected}`), found: n(sql`${auditItems.result} = 'found'`),
            missing: n(sql`${auditItems.result} = 'missing'`), unexpected: n(sql`not ${auditItems.expected}`),
            closed: audits.closedAt, by: audits.createdBy,
          })
          .from(audits)
          .orderBy(desc(audits.createdAt))
          .limit(limit)
      ).map((r) => [r.started, r.name, r.state === "open" ? "Open" : "Closed", r.expected, r.found, r.missing, r.unexpected, r.closed, r.by]);
    },
  },
];

/**
 * Assets with a cost (not archived), with their category's rule. Disposed ones are included with their
 * disposal date so each report can decide; disposed ones without a date (from before dates were recorded) are left out.
 */
async function depreciable(tx: Tx, limit: number, filter?: SQL, order = asc(assets.tag)) {
  const rows = await tx
    .select({
      tag: assets.tag, name: assets.name, category: categories.name, purchaseDate: assets.purchaseDate, cost: assets.cost,
      disposedOn: assets.disposedOn, disposalMethod: assets.disposalMethod, disposalValue: assets.disposalValue,
      rule: {
        depMethod: categories.depMethod, depLifeYears: categories.depLifeYears,
        depRatePct: categories.depRatePct, depSalvagePct: categories.depSalvagePct,
      },
    })
    .from(assets)
    .leftJoin(categories, eq(categories.id, assets.categoryId))
    .where(and(live, sql`${assets.cost} is not null`, sql`(${assets.status} <> 'disposed' or ${assets.disposedOn} is not null)`, filter))
    .orderBy(order, asc(assets.tag))
    .limit(limit);
  // A left join with no category gives a rule of nulls.
  return rows.map((r) => ({ ...r, rule: r.rule?.depMethod ? r.rule : null }));
}

const methodLabel = (rule: DepRule | null, d: unknown) =>
  !rule ? "No category" : !d && rule.depMethod !== "none" ? `${DEP_LABEL[rule.depMethod]} — needs purchase date` : DEP_LABEL[rule.depMethod];

/** First and last day of the financial year starting in `fy`, month `startMonth` (1–12). */
export function fyBounds(fy: number, startMonth = 4) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = new Date(Date.UTC(fy + 1, startMonth - 1, 1) - 864e5).toISOString().slice(0, 10);
  return { from: `${fy}-${pad(startMonth)}-01`, to: next };
}

/** "FY 2026–27", or "FY 2026" when the year starts in January. */
export const fyLabel = (fy: number, startMonth = 4) => (startMonth === 1 ? `FY ${fy}` : `FY ${fy}–${String(fy + 1).slice(2)}`);

/**
 * ?fy=2026 means the financial year starting in 2026 (by default 1 Apr 2026 – 31 Mar 2027);
 * defaults to the current one in the org's timezone.
 */
export function fiscalRange(sp: Record<string, string | string[] | undefined>, tz: string, startMonth = 4) {
  const today = isoDateIn(new Date(), tz);
  const current = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < startMonth ? 1 : 0);
  const asked = typeof sp.fy === "string" && /^\d{4}$/.test(sp.fy) ? Number(sp.fy) : current;
  return { fy: asked, current, startMonth, ...fyBounds(asked, startMonth) };
}

/** Reads from/to (YYYY-MM-DD) from search params; defaults to this year so far in the org's timezone. */
export function reportRange(sp: Record<string, string | string[] | undefined>, tz: string) {
  const today = isoDateIn(new Date(), tz);
  const day = (v: unknown, fallback: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
  return { from: day(sp.from, `${today.slice(0, 4)}-01-01`), to: day(sp.to, today) };
}

/** Money columns summed for the total row (null when the report has none). */
export function totals(columns: Column[], rows: Cell[][]) {
  if (!columns.some((c) => c.kind === "money")) return null;
  return columns.map((c, i) => (c.kind === "money" ? rows.reduce((s, r) => s + Number(r[i] ?? 0), 0) : null));
}

type Params = Record<string, string | string[] | undefined>;

/**
 * Runs a report for the given query parameters: its date filter, and `col` (repeated) to choose
 * columns by index. Shared by the report page, CSV export and scheduled emails.
 */
export async function runReport(tx: Tx, report: Report, sp: Params, tz: string, limit: number, fyStartMonth = 4) {
  const fiscal = report.fiscalYear ? fiscalRange(sp, tz, fyStartMonth) : null;
  const range = fiscal ?? reportRange(sp, tz);
  const all = report.columnsFor ? await report.columnsFor(tx) : report.columns;
  const picked = new Set([sp.col ?? []].flat().map(Number));
  const keep = all.map((_, i) => i).filter((i) => picked.size === 0 || picked.has(i));
  const rows = (await report.run(tx, { tz, ...range }, limit)).map((r) => keep.map((i) => r[i]));
  const params = new URLSearchParams(
    fiscal ? { fy: String(fiscal.fy) } : report.dateRange ? range : report.asOf ? { to: range.to } : {},
  );
  if (picked.size > 0) keep.forEach((i) => params.append("col", String(i)));
  const suffix = fiscal
    ? fyLabel(fiscal.fy, fyStartMonth).replace(/[ –]/g, (c) => (c === " " ? "" : "-"))
    : report.dateRange ? `${range.from}-to-${range.to}` : report.asOf ? `as-of-${range.to}` : isoDateIn(new Date(), tz);
  return { all, keep, columns: keep.map((i) => all[i]), rows, range, fiscal, params: params.toString(), filename: `${report.slug}-${suffix}.csv` };
}

/** Dates as YYYY-MM-DD in the org's timezone so spreadsheets sort and filter them. */
export const csvRows = (rows: Cell[][], tz: string) => rows.map((r) => r.map((v) => (v instanceof Date ? isoDateIn(v, tz) : v)));
