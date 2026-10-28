export function fmtDateTime(d: Date | string | null | undefined, tz: string) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(d));
}

export function fmtDate(d: Date | string | null | undefined, tz: string) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz }).format(new Date(d));
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
        `Checked out to ${p.holderName}`,
        p.dueAt && `due ${fmtDate(p.dueAt as string, tz)}`,
        p.condition && `condition ${p.condition}`,
        p.notes && `“${p.notes}”`,
      ]);
    case "checked_in":
      return bits([
        `Checked in from ${p.holderName} after ${p.daysHeld} day${p.daysHeld === 1 ? "" : "s"}`,
        p.condition && `condition ${p.condition}`,
        p.returnLocationName && `returned to ${p.returnLocationName}`,
        p.notes && `“${p.notes}”`,
      ]);
    case "due_extended":
      return `Due date for ${p.holderName} changed: ${fmtDate(p.from as string, tz)} → ${fmtDate(p.to as string, tz)}`;
    case "created":
      return "Asset created";
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
  correction: "Correction",
};
