import Link from "next/link";
import { asc, eq, ilike, isNull, or } from "drizzle-orm";
import { withOrg } from "@/db";
import { persons, subscriptions } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtMoney, isoDateIn } from "@/lib/format";
import { can } from "@/lib/permissions";
import { dueState, monthlyCost, periodLabel } from "@/lib/subscriptions";
import { btn, card, h1, input, td, th } from "@/lib/ui";
import { addSubscription } from "./actions";
import { DUE_BADGE, SubscriptionFields } from "./subscription-fields";

export default async function SubscriptionsPage({ searchParams }: PageProps<"/subscriptions">) {
  const user = await requireUser();
  const q = String((await searchParams).q ?? "").trim();
  const like = `%${q}%`;
  const { rows, people } = await withOrg(user.orgId, async (tx) => ({
    rows: await tx
      .select({ s: subscriptions, owner: persons.name })
      .from(subscriptions)
      .leftJoin(persons, eq(persons.id, subscriptions.ownerId))
      .where(q ? or(ilike(subscriptions.tag, like), ilike(subscriptions.name, like), ilike(subscriptions.vendor, like)) : undefined)
      .orderBy(asc(subscriptions.state), asc(subscriptions.nextDueOn)),
    people: await tx.select({ id: persons.id, name: persons.name }).from(persons).where(isNull(persons.deletedAt)).orderBy(asc(persons.name)),
  }));
  const today = isoDateIn(new Date(), user.timezone);
  // Totals per currency: converting needs exchange rates, so USD and INR are summed separately.
  const totals = new Map<string, number>();
  for (const { s } of rows) if (s.state === "active") totals.set(s.currency, (totals.get(s.currency) ?? 0) + monthlyCost(s.amount, s.periodMonths));

  return (
    <>
      <div>
        <h1 className={h1}>Software subscriptions</h1>
        <p className="text-sm text-muted-foreground">What you pay for software and services, how often it&apos;s recharged, and when the next payment is due.</p>
      </div>

      {totals.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...totals].map(([cur, monthly]) => (
            <div key={cur} className={`${card} min-w-48 py-3`}>
              <p className="text-xs text-muted-foreground">Active, per month ({cur})</p>
              <p className="text-xl font-semibold">{fmtMoney(monthly, cur)}</p>
              <p className="text-xs text-muted-foreground">{fmtMoney(monthly * 12, cur)} a year</p>
            </div>
          ))}
        </div>
      )}

      {can(user, "records") && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Add a subscription</summary>
          <ActionForm action={addSubscription} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            <SubscriptionFields people={people} currency={user.currency} today={today} />
            <button className={btn}>Add</button>
          </ActionForm>
        </details>
      )}

      <form className="flex gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search by tag, name or vendor" aria-label="Search subscriptions" className={`${input} max-w-sm`} />
        <button className={btn}>Search</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Tag</th>
              <th className={th}>Name</th>
              <th className={th}>Vendor</th>
              <th className={`${th} text-right`}>Billing</th>
              <th className={th}>Every</th>
              <th className={th}>Next recharge</th>
              <th className={th}>Owner</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ s, owner }) => {
              const due = dueState(s, today);
              return (
                <tr key={s.id} className="hover:bg-muted/40">
                  <td className={`${td} whitespace-nowrap`}>
                    <Link href={`/subscriptions/${s.id}`} className="font-mono font-medium text-primary hover:underline">
                      {s.tag}
                    </Link>
                  </td>
                  <td className={td}>
                    {s.name}
                    {s.plan && <span className="text-muted-foreground"> · {s.plan}</span>}
                  </td>
                  <td className={td}>{s.vendor ?? "—"}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>{fmtMoney(s.amount, s.currency)}</td>
                  <td className={td}>{periodLabel(s.periodMonths)}</td>
                  <td className={`${td} whitespace-nowrap`}>{s.state === "cancelled" ? "—" : fmtDate(s.nextDueOn, "UTC")}</td>
                  <td className={td}>{owner ?? "—"}</td>
                  <td className={td}>
                    <span className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${DUE_BADGE[due][1]}`}>{due === "off" ? (s.state === "paused" ? "Paused" : "Cancelled") : DUE_BADGE[due][0]}</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className={`${td} text-muted-foreground`}>
                  {q ? "No subscription matches that search." : "No subscriptions yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
