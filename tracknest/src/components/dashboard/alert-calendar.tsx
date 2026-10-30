import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type CalendarItem = { date: string; kind: keyof typeof KINDS; label: string; href: string };

const KINDS = {
  due: { name: "Asset due back", dot: "bg-blue-500" },
  maintenance: { name: "Maintenance due", dot: "bg-green-500" },
  reminder: { name: "Date reminder", dot: "bg-red-500" },
  warranty: { name: "Warranty ends", dot: "bg-violet-500" },
  reservation: { name: "Reservation starts", dot: "bg-amber-500" },
};
const MAX_PER_DAY = 3;

/** Month grid (weeks start on Sunday) of everything due on each day. `month` is YYYY-MM. */
export function AlertCalendar({ month, today, items }: { month: string; today: string; items: CalendarItem[] }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const shift = (n: number) => new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/dashboard?month=${shift(-1)}`} aria-label="Previous month" className="rounded p-1 hover:bg-muted">
          <ChevronLeft className="size-4" />
        </Link>
        <p className="font-medium">{first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
        <Link href={`/dashboard?month=${shift(1)}`} aria-label="Next month" className="rounded p-1 hover:bg-muted">
          <ChevronRight className="size-4" />
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-muted/50 py-1 text-center font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          const on = d ? items.filter((it) => it.date === day(d)) : [];
          return (
            <div key={i} className={`min-h-16 bg-card p-1 ${d && day(d) === today ? "ring-2 ring-primary ring-inset" : ""}`}>
              {d && <p className="text-muted-foreground">{d}</p>}
              {on.slice(0, MAX_PER_DAY).map((it, j) => (
                <Link key={j} href={it.href} title={`${KINDS[it.kind].name}: ${it.label}`} className="flex items-center gap-1 truncate hover:underline">
                  <span className={`size-1.5 shrink-0 rounded-full ${KINDS[it.kind].dot}`} />
                  <span className="truncate">{it.label}</span>
                </Link>
              ))}
              {on.length > MAX_PER_DAY && <p className="text-muted-foreground">+{on.length - MAX_PER_DAY} more</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {Object.values(KINDS).map((k) => (
          <span key={k.name} className="flex items-center gap-1">
            <span className={`size-2 rounded-full ${k.dot}`} /> {k.name}
          </span>
        ))}
      </div>
    </div>
  );
}
