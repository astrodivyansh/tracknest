import { cache } from "react";
import type { DateFormat } from "@/db/schema";
import { STATUS_LABEL } from "./labels";

export const DATE_FORMAT_LABEL: Record<DateFormat, string> = { medium: "1 Sept 2026", dmy: "01/09/2026", mdy: "09/01/2026", iso: "2026-09-01" };
const DATE_OPTIONS: Record<DateFormat, [string, Intl.DateTimeFormatOptions]> = {
  medium: ["en-GB", { dateStyle: "medium" }],
  dmy: ["en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }],
  mdy: ["en-US", { day: "2-digit", month: "2-digit", year: "numeric" }],
  iso: ["en-CA", { day: "2-digit", month: "2-digit", year: "numeric" }],
};

/**
 * The org's date format for this request. React cache gives one object per server render;
 * getCurrentUser fills it in, so pages (which all load the user first) show the org's format.
 * Outside a render (emails, CSV, tests) it stays the default.
 */
const requestFormat = cache((): { value: DateFormat } => ({ value: "medium" }));
export const setDateFormat = (f: DateFormat) => void (requestFormat().value = f);

export function fmtDate(d: Date | string | null | undefined, tz: string) {
  if (!d) return "—";
  const [locale, opts] = DATE_OPTIONS[requestFormat().value];
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz }).format(new Date(d));
}

export function fmtDateTime(d: Date | string | null | undefined, tz: string) {
  if (!d) return "—";
  const time = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: tz }).format(new Date(d));
  return `${fmtDate(d, tz)}, ${time}`;
}

export function fmtMoney(v: string | number | null | undefined, currency: string) {
  if (v === null || v === undefined || v === "") return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(v));
}

// Offset of `tz` from UTC at instant `d`, in ms.
function tzOffsetMs(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - d.getTime();
}

/** "2026-11-05" → 23:59:59 that day in the org's timezone, as a UTC Date. */
export function endOfDayIn(dateStr: string, tz: string) {
  const guess = new Date(`${dateStr}T23:59:59Z`);
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}

/** "2026-11-05" → 00:00:00 that day in the org's timezone. */
export function startOfDayIn(dateStr: string, tz: string) {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}

type EventLike = { type: string; payload: Record<string, unknown> };

/** One-line, human description of a history event. */
export function describeEvent(e: EventLike, tz: string) {
  const p = e.payload as Record<string, string | number | null | string[]>;
  const bits = (xs: unknown[]) => xs.filter(Boolean).join(" · ");
  switch (e.type) {
    case "checked_out":
      return bits([
        `${p.holderType === "customer" ? "Leased" : "Checked out"} to ${p.holderName}`,
        p.dueAt && `due ${fmtDate(p.dueAt as string, tz)}`,
        p.condition && `condition ${p.condition}`,
        p.notes && `“${p.notes}”`,
      ]);
    case "checked_in":
      return bits([
        `${p.holderType === "customer" ? "Lease returned" : "Checked in"} from ${p.holderName} after ${p.daysHeld} day${p.daysHeld === 1 ? "" : "s"}`,
        p.condition && `condition ${p.condition}`,
        p.returnLocationName && `returned to ${p.returnLocationName}`,
        p.notes && `“${p.notes}”`,
      ]);
    case "due_extended":
      return `Due date for ${p.holderName} changed: ${fmtDate(p.from as string, tz)} → ${fmtDate(p.to as string, tz)}`;
    case "status_changed": {
      const d = p.disposal as unknown as { on: string; method: string; value: string | null } | undefined;
      return bits([
        `Status: ${STATUS_LABEL[p.from as string] ?? p.from} → ${STATUS_LABEL[p.to as string] ?? p.to}`,
        d && `${d.method.replace("_", " ")} on ${fmtDate(d.on, "UTC")}${d.value ? ` for ${d.value}` : ""}`,
        p.reason && `“${p.reason}”`,
      ]);
    }
    case "maintenance_scheduled":
      return bits([
        `Maintenance scheduled: ${p.title}`,
        p.dueDate && `due ${fmtDate(p.dueDate as string, "UTC")}`,
        p.repeatMonths && `repeats every ${p.repeatMonths} month${p.repeatMonths === 1 ? "" : "s"}`,
        p.vendor,
      ]);
    case "maintenance_started":
      return bits([`Sent for maintenance: ${p.title}`, p.vendor]);
    case "maintenance_completed":
      return bits([
        `Maintenance completed: ${p.title}`,
        p.cost && `cost ${p.cost}`,
        p.notes && `“${p.notes}”`,
        p.assetStatus && `now ${STATUS_LABEL[p.assetStatus as string]?.toLowerCase()}`,
      ]);
    case "maintenance_cancelled":
      return bits([`Maintenance cancelled: ${p.title}`, p.reason && `“${p.reason}”`]);
    case "audited":
      return bits([
        `Audit “${p.auditName}”: ${p.result === "found" ? "found" : "not found"}`,
        p.result === "found" && p.locationName && `in ${p.locationName}`,
        p.movedFrom !== undefined && `moved from ${p.movedFrom ?? "no location"}`,
      ]);
    case "reserved":
      return bits([
        `Reserved for ${p.holderName}: ${fmtDate(p.startDate as string, "UTC")} – ${fmtDate(p.endDate as string, "UTC")}`,
        p.notes && `“${p.notes}”`,
      ]);
    case "reservation_cancelled":
      return bits([
        `Reservation for ${p.holderName} (${fmtDate(p.startDate as string, "UTC")} – ${fmtDate(p.endDate as string, "UTC")}) cancelled`,
        p.reason && `“${p.reason}”`,
      ]);
    case "file_added":
      return `${p.kind === "photo" ? "Photo" : "Document"} added: ${p.filename}`;
    case "file_removed":
      return `${p.kind === "photo" ? "Photo" : "Document"} removed: ${p.filename}`;
    case "warranty_added":
      return bits([`Warranty added: until ${fmtDate(p.expiresOn as string, "UTC")}`, p.provider, p.notes && `“${p.notes}”`]);
    case "warranty_removed":
      return bits([`Warranty removed (was until ${fmtDate(p.expiresOn as string, "UTC")})`, p.provider]);
    case "record_linked":
      return bits([`Linked to ${p.kind}: ${p.name}`, p.reference]);
    case "record_unlinked":
      return bits([`Unlinked from ${p.kind}: ${p.name}`, p.reference]);
    case "custom":
      return bits([`${p.name} on ${fmtDate(p.on as string, "UTC")}`, p.notes && `“${p.notes}”`]);
    case "archived":
      return bits(["Asset archived", p.reason && `“${p.reason}”`]);
    case "created":
      return p.copiedFrom ? `Asset created as a copy of ${p.copiedFrom}` : "Asset created";
    case "moved":
      return bits([
        p.toLocation !== undefined && `Location: ${p.fromLocation ?? "none"} → ${p.toLocation ?? "none"}`,
        p.toDepartment !== undefined && `Department: ${p.fromDepartment ?? "none"} → ${p.toDepartment ?? "none"}`,
      ]);
    case "linked":
      return p.role === "child" ? `Linked under ${p.otherTag} ${p.otherName}` : `${p.otherTag} ${p.otherName} linked under this asset`;
    case "unlinked":
      return p.role === "child" ? `Unlinked from ${p.otherTag} ${p.otherName}` : `${p.otherTag} ${p.otherName} unlinked from this asset`;
    case "edited":
      return `Edited: ${Object.keys((p.changes as unknown as Record<string, unknown>) ?? {}).join(", ")}`;
    default:
      return e.type.replace(/_/g, " ");
  }
}

export const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  checked_out: "Checked out",
  checked_in: "Checked in",
  due_extended: "Due extended",
  status_changed: "Status changed",
  moved: "Moved",
  linked: "Linked",
  unlinked: "Unlinked",
  maintenance_scheduled: "Maintenance scheduled",
  maintenance_started: "Maintenance started",
  maintenance_completed: "Maintenance completed",
  maintenance_cancelled: "Maintenance cancelled",
  archived: "Archived",
  file_added: "File added",
  file_removed: "File removed",
  warranty_added: "Warranty added",
  warranty_removed: "Warranty removed",
  record_linked: "Record linked",
  record_unlinked: "Record unlinked",
  custom: "Event",
  reserved: "Reserved",
  reservation_cancelled: "Reservation cancelled",
  audited: "Audited",
  correction: "Correction",
};

/** Calendar date of `d` in `tz` as YYYY-MM-DD (for CSVs and date inputs). */
export function isoDateIn(d: Date | string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
}
