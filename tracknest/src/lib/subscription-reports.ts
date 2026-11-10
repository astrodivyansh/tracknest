import { asc, eq, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { departments, persons, subscriptionLinks, subscriptionPayments, subscriptions } from "@/db/schema";
import { addMonths } from "./maintenance";
import { monthlyCost, periodLabel, priceChange } from "./subscriptions";
import type { Cell, Report } from "./reports";

// Amounts are "number" columns with a Currency column beside them: a money column would total
// USD and INR together in the org's currency.
const round = (n: number) => Math.round(n * 100) / 100;
const STATE = { active: "Active", paused: "Paused", cancelled: "Cancelled" };

/** Each subscription with its owner, department and seat use. */
async function overview(tx: Tx) {
  return tx
    .select({
      s: subscriptions,
      owner: persons.name,
      department: departments.name,
      assigned: sql<number>`(select count(*) from ${subscriptionLinks} where ${subscriptionLinks.subscriptionId} = ${subscriptions.id} and ${subscriptionLinks.personId} is not null)::int`,
    })
    .from(subscriptions)
    .leftJoin(persons, eq(persons.id, subscriptions.ownerId))
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .orderBy(asc(subscriptions.name));
}

/** Due dates of one subscription from its next recharge up to `to`, overdue ones included. */
export function dueDates(s: { nextDueOn: string; periodMonths: number }, to: string) {
  const out: string[] = [];
  for (let d = s.nextDueOn, n = 0; d <= to && n < 120; d = addMonths(s.nextDueOn, s.periodMonths * ++n)) out.push(d);
  return out;
}

export const SUBSCRIPTION_REPORTS: Report[] = [
  {
    slug: "subscriptions",
    title: "Software subscriptions",
    description: "Every subscription with what it costs per month and per year, and how many paid seats are in use.",
    columns: [
      { label: "Tag" }, { label: "Name" }, { label: "Vendor" }, { label: "Plan" }, { label: "Owner" }, { label: "Department" },
      { label: "Currency" }, { label: "Billing", kind: "number" }, { label: "Every" }, { label: "Per month", kind: "number" }, { label: "Per year", kind: "number" },
      { label: "Next recharge", kind: "date" }, { label: "Auto-renew" }, { label: "Seats", kind: "number" }, { label: "Assigned", kind: "number" },
      { label: "Unused", kind: "number" }, { label: "Status" },
    ],
    run: async (tx, _ctx, limit) =>
      (await overview(tx)).slice(0, limit).map(({ s, owner, department, assigned }): Cell[] => [
        s.tag, s.name, s.vendor, s.plan, owner, department, s.currency, Number(s.amount), periodLabel(s.periodMonths),
        round(monthlyCost(s.amount, s.periodMonths)), round(monthlyCost(s.amount, s.periodMonths) * 12),
        s.state === "cancelled" ? null : s.nextDueOn, s.autoRenew ? "Yes" : "", s.seats, assigned,
        s.seats === null ? null : Math.max(0, s.seats - assigned), STATE[s.state],
      ]),
  },
  {
    slug: "subscription-renewals",
    title: "Upcoming software recharges",
    description: "Every recharge due in the period, monthly ones repeated, plus any already overdue. Pick 30, 60 or 90 days ahead.",
    dateRange: true,
    upcoming: true,
    columns: [
      { label: "Due", kind: "date" }, { label: "Days left", kind: "number" }, { label: "Tag" }, { label: "Name" }, { label: "Vendor" },
      { label: "Currency" }, { label: "Amount", kind: "number" }, { label: "Auto-renew" }, { label: "Owner" },
    ],
    run: async (tx, { from, to, tz }, limit) => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      const rows = (await overview(tx))
        .filter(({ s }) => s.state === "active")
        .flatMap(({ s, owner }) =>
          dueDates(s, to)
            .filter((d) => d >= from || d < today)
            .map((d): Cell[] => [d, Math.round((Date.parse(d) - Date.parse(today)) / 864e5), s.tag, s.name, s.vendor, s.currency, Number(s.amount), s.autoRenew ? "Yes" : "", owner]),
        );
      return rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
    },
  },
  {
    slug: "subscription-spend",
    title: "Software spend by vendor and department",
    description: "What active subscriptions cost per month and per year, grouped by vendor and by the owner's department.",
    columns: [
      { label: "Grouped by" }, { label: "Name" }, { label: "Currency" }, { label: "Subscriptions", kind: "number" },
      { label: "Per month", kind: "number" }, { label: "Per year", kind: "number" },
    ],
    run: async (tx, _ctx, limit) => {
      const active = (await overview(tx)).filter(({ s }) => s.state === "active");
      const group = (by: string, nameOf: (r: (typeof active)[number]) => string | null, none: string) => {
        const sums = new Map<string, { name: string; currency: string; n: number; month: number }>();
        for (const r of active) {
          const name = nameOf(r) || none;
          const k = `${name.toLowerCase()}|${r.s.currency}`;
          const g = sums.get(k) ?? { name, currency: r.s.currency, n: 0, month: 0 };
          g.n++;
          g.month += monthlyCost(r.s.amount, r.s.periodMonths);
          sums.set(k, g);
        }
        return [...sums.values()].sort((a, b) => b.month - a.month).map((g): Cell[] => [by, g.name, g.currency, g.n, round(g.month), round(g.month * 12)]);
      };
      return [...group("Vendor", (r) => r.s.vendor, "No vendor"), ...group("Department", (r) => r.department, "No department")].slice(0, limit);
    },
  },
  {
    slug: "subscription-payments",
    title: "Software recharges paid",
    description: "Every recharge recorded in the period, with the change from the one before.",
    dateRange: true,
    columns: [
      { label: "Paid on", kind: "date" }, { label: "Tag" }, { label: "Name" }, { label: "Vendor" }, { label: "Currency" },
      { label: "Amount", kind: "number" }, { label: "Change %", kind: "number" }, { label: "Period from", kind: "date" }, { label: "Period to", kind: "date" },
      { label: "Invoice no." }, { label: "Recorded by" },
    ],
    run: async (tx, { from, to }, limit) => {
      // Oldest first up to `to`, so each payment can be compared with the one before it.
      const rows = await tx
        .select({ p: subscriptionPayments, tag: subscriptions.tag, name: subscriptions.name, vendor: subscriptions.vendor })
        .from(subscriptionPayments)
        .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPayments.subscriptionId))
        .where(lte(subscriptionPayments.paidOn, to))
        .orderBy(asc(subscriptionPayments.paidOn), asc(subscriptionPayments.recordedAt));
      const last = new Map<string, string>();
      const out = rows.map((r) => {
        const k = `${r.p.subscriptionId}|${r.p.currency}`;
        const change = priceChange(last.get(k), r.p.amount);
        last.set(k, r.p.amount);
        return { paidOn: r.p.paidOn, cells: [r.p.paidOn, r.tag, r.name, r.vendor, r.p.currency, Number(r.p.amount), change, r.p.periodFrom, r.p.periodTo, r.p.reference, r.p.actorName] as Cell[] };
      });
      return out.filter((r) => r.paidOn >= from).reverse().slice(0, limit).map((r) => r.cells);
    },
  },
];

