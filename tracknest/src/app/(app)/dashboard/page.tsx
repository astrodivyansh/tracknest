import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, between, count, eq, inArray, isNull, lt, lte, ne, sql, sum } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assets, categories, checkouts, maintenance, reservations, subscriptions, users, warranties } from "@/db/schema";
import { AlertCalendar, type CalendarItem } from "@/components/dashboard/alert-calendar";
import { Feeds, type FeedItem } from "@/components/dashboard/feeds";
import { ValueChart } from "@/components/dashboard/value-chart";
import { isAdmin, requireUser } from "@/lib/auth";
import { orgClock, STATUS_LABEL } from "@/lib/custody";
import { widgetsFor, type WidgetKey } from "@/lib/dashboard-widgets";
import { LAST_STEP } from "@/lib/wizard";
import { describeEvent, fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { listEvents } from "@/lib/history";
import { todayIn } from "@/lib/maintenance";
import { datesInRange, upcomingDates } from "@/lib/reminders";
import { fiscalRange, fyLabel } from "@/lib/reports";
import { card, h1, h2, td, th } from "@/lib/ui";

const live = and(isNull(assets.deletedAt), ne(assets.status, "disposed"));

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  if (isAdmin(user) && user.setupStep <= LAST_STEP) redirect("/wizard"); // where everyone lands after signing in
  const tz = user.timezone;
  const sp = await searchParams;
  const fy = fiscalRange({}, tz, user.fyStartMonth);

  const data = await withOrg(user.orgId, async (tx) => {
    const { today } = await orgClock(tx, user.orgId);
    const month = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const monthEnd = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const inMonth = (col: Parameters<typeof between>[0]) => between(col, `${month}-01`, monthEnd);
    const dueDay = sql<string>`to_char(${checkouts.dueAt} at time zone ${tz}, 'YYYY-MM-DD')`;

    const [active] = await tx.select({ n: count(), value: sum(assets.cost) }).from(assets).where(live);
    const [bought] = await tx
      .select({ n: count(), value: sum(assets.cost) })
      .from(assets)
      .where(and(isNull(assets.deletedAt), between(assets.purchaseDate, fy.from, fy.to)));
    const feed = async (type: "checked_out" | "checked_in"): Promise<FeedItem[]> =>
      (await listEvents(tx, { type }, tz, 8)).map((e) => ({
        id: e.id,
        assetId: e.assetId,
        tag: e.assetTag,
        text: describeEvent(e, tz),
        when: `${fmtDateTime(e.occurredAt, tz)} · ${e.actorName}`,
      }));

    return {
      today,
      month,
      active,
      bought,
      checkedOut: (await tx.select({ n: count() }).from(assets).where(and(live, eq(assets.status, "checked_out"))))[0].n,
      maintDue: (
        await tx
          .select({ n: count() })
          .from(maintenance)
          .where(and(eq(maintenance.state, "scheduled"), lte(maintenance.dueDate, sql`${todayIn(tz)} + 7`)))
      )[0].n,
      byCategory: (
        await tx
          .select({ category: sql<string>`coalesce(${categories.name}, 'Uncategorised')`, value: sum(assets.cost), count: count() })
          .from(assets)
          .leftJoin(categories, eq(categories.id, assets.categoryId))
          .where(live)
          .groupBy(categories.name)
          .orderBy(sql`sum(${assets.cost}) desc nulls last`)
      ).map((r) => ({ ...r, value: Number(r.value ?? 0) })),
      overdue: await tx
        .select({ assetId: assets.id, tag: assets.tag, name: assets.name, holder: checkouts.holderName, dueAt: checkouts.dueAt })
        .from(checkouts)
        .innerJoin(assets, eq(assets.id, checkouts.assetId))
        .where(and(eq(checkouts.state, "open"), lt(checkouts.dueAt, new Date())))
        .orderBy(asc(checkouts.dueAt))
        .limit(20),
      coming: await upcomingDates(tx, today, 10),
      calendar: [
        ...(
          await tx
            .select({ date: dueDay, assetId: assets.id, tag: assets.tag, holder: checkouts.holderName })
            .from(checkouts)
            .innerJoin(assets, eq(assets.id, checkouts.assetId))
            .where(and(eq(checkouts.state, "open"), sql`${dueDay} between ${`${month}-01`} and ${monthEnd}`))
        ).map((r): CalendarItem => ({ date: r.date, kind: "due", label: `${r.tag} · ${r.holder}`, href: `/assets/${r.assetId}` })),
        ...(
          await tx
            .select({ date: maintenance.dueDate, assetId: assets.id, tag: assets.tag, title: maintenance.title })
            .from(maintenance)
            .innerJoin(assets, eq(assets.id, maintenance.assetId))
            .where(and(eq(maintenance.state, "scheduled"), inMonth(maintenance.dueDate)))
        ).map((r): CalendarItem => ({ date: r.date!, kind: "maintenance", label: `${r.tag} · ${r.title}`, href: `/assets/${r.assetId}` })),
        ...(
          await tx
            .select({ date: reservations.startDate, assetId: assets.id, tag: assets.tag, holder: reservations.holderName })
            .from(reservations)
            .innerJoin(assets, eq(assets.id, reservations.assetId))
            .where(and(eq(reservations.state, "active"), inMonth(reservations.startDate)))
        ).map((r): CalendarItem => ({ date: r.date, kind: "reservation", label: `${r.tag} · ${r.holder}`, href: `/assets/${r.assetId}` })),
        ...(
          await tx
            .select({ date: warranties.expiresOn, assetId: assets.id, tag: assets.tag })
            .from(warranties)
            .innerJoin(assets, eq(assets.id, warranties.assetId))
            .where(and(live, inMonth(warranties.expiresOn)))
        ).map((r): CalendarItem => ({ date: r.date, kind: "warranty", label: `${r.tag} · warranty ends`, href: `/assets/${r.assetId}` })),
        ...(
          await tx
            .select({ date: subscriptions.nextDueOn, id: subscriptions.id, tag: subscriptions.tag, name: subscriptions.name })
            .from(subscriptions)
            .where(and(eq(subscriptions.state, "active"), inMonth(subscriptions.nextDueOn)))
        ).map((r): CalendarItem => ({ date: r.date, kind: "subscription", label: `${r.tag} · ${r.name} recharge`, href: `/subscriptions/${r.id}` })),
        ...(await datesInRange(tx, `${month}-01`, monthEnd)).map(
          (r): CalendarItem => ({ date: r.date, kind: "reminder", label: `${r.tag} · ${r.label}`, href: `/assets/${r.assetId}` }),
        ),
      ],
      feeds: {
        out: await feed("checked_out"),
        in: await feed("checked_in"),
        repair: (
          await tx
            .select({ id: assets.id, tag: assets.tag, name: assets.name, status: assets.status, updatedAt: assets.updatedAt })
            .from(assets)
            .where(and(isNull(assets.deletedAt), inArray(assets.status, ["under_maintenance", "broken"])))
            .orderBy(sql`${assets.updatedAt} desc`)
            .limit(8)
        ).map((a): FeedItem => ({
          id: a.id,
          assetId: a.id,
          tag: a.tag,
          text: `${a.name} · ${STATUS_LABEL[a.status]}`,
          when: `since ${fmtDateTime(a.updatedAt, tz)}`,
        })),
      },
    };
  });

  const kpis = [
    { label: "Active assets", value: data.active.n.toLocaleString("en-IN"), href: "/assets" },
    { label: "Value of assets", value: fmtMoney(data.active.value ?? 0, user.currency), href: "/reports/by-category" },
    {
      label: `Purchases in ${fyLabel(fy.fy, fy.startMonth)}`,
      value: fmtMoney(data.bought.value ?? 0, user.currency),
      sub: `${data.bought.n} asset${data.bought.n === 1 ? "" : "s"}`,
      href: "/reports/depreciation-schedule",
    },
    { label: "Checked out", value: data.checkedOut, href: "/assets?status=checked_out" },
    { label: "Overdue", value: data.overdue.length, href: "/reports/overdue", alert: data.overdue.length > 0 },
    { label: "Maintenance due (7 days)", value: data.maintDue, href: "/maintenance", alert: data.maintDue > 0 },
  ];

  const [me] = await db.select({ dashboard: users.dashboard }).from(users).where(eq(users.id, user.id));
  const layout = widgetsFor(me.dashboard);

  const widgets: Record<WidgetKey, React.ReactNode> = {
    kpis: (
      <div key="kpis" className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:col-span-2 xl:grid-cols-6">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className={`${card} p-4 hover:border-primary/40`}>
            <p className="text-sm text-muted-foreground">{k.label}</p>
            <p className={`text-2xl font-semibold ${k.alert ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>{k.value}</p>
            {k.sub && <p className="text-xs text-muted-foreground">{k.sub}</p>}
          </Link>
        ))}
      </div>
    ),
    value: (
      <section key="value" className={card}>
        <h2 className={`${h2} mb-3`}>Asset value by category</h2>
        <ValueChart data={data.byCategory} currency={user.currency} />
      </section>
    ),
    calendar: (
      <section key="calendar" className={card}>
        <h2 className={`${h2} mb-3`}>Alerts calendar</h2>
        <AlertCalendar month={data.month} today={data.today} items={data.calendar} />
      </section>
    ),
    activity: (
      <section key="activity" className={card}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className={h2}>Activity</h2>
          <Link href="/history" className="text-sm text-primary hover:underline">
            Full history
          </Link>
        </div>
        <Feeds
          tabs={[
            { key: "out", label: "Checked out", items: data.feeds.out, empty: "Nothing checked out yet." },
            { key: "in", label: "Checked in", items: data.feeds.in, empty: "Nothing checked in yet." },
            { key: "repair", label: "Maintenance / broken", items: data.feeds.repair, empty: "No assets in maintenance or broken." },
          ]}
        />
      </section>
    ),
    overdue: (
      <section key="overdue" className="space-y-2">
        <h2 className={h2}>Overdue returns</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th className={th}>Asset</th>
                <th className={th}>Held by</th>
                <th className={th}>Was due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.overdue.map((o) => (
                <tr key={o.assetId}>
                  <td className={td}>
                    <Link href={`/assets/${o.assetId}`} className="font-mono text-primary hover:underline">
                      {o.tag}
                    </Link>{" "}
                    {o.name}
                  </td>
                  <td className={td}>{o.holder}</td>
                  <td className={`${td} text-red-700 dark:text-red-400`}>{fmtDate(o.dueAt, tz)}</td>
                </tr>
              ))}
              {data.overdue.length === 0 && (
                <tr>
                  <td colSpan={3} className={`${td} text-muted-foreground`}>
                    Nothing overdue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    ),
    coming:
      data.coming.length > 0 ? (
        <section key="coming" className={card}>
          <h2 className={h2}>Coming up</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {data.coming.map((c) => (
              <li key={`${c.assetId}${c.label}`}>
                <span className="font-medium">{fmtDate(c.date, "UTC")}</span> · {c.label} ·{" "}
                <Link href={`/assets/${c.assetId}`} className="font-mono text-primary hover:underline">
                  {c.tag}
                </Link>{" "}
                {c.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null,
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className={h1}>Dashboard</h1>
        <Link href="/dashboard/customize" className="text-sm text-primary hover:underline">
          Customize
        </Link>
      </div>

      {data.active.n === 0 && (
        <section className={card}>
          <h2 className={h2}>Get started</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>
              <Link href="/setup" className="text-primary hover:underline">Add a site, locations and categories</Link>
            </li>
            <li>
              <Link href="/people" className="text-primary hover:underline">Add the people who hold assets</Link>
            </li>
            <li>
              <Link href="/assets/new" className="text-primary hover:underline">Add your first asset</Link> and check it out
            </li>
          </ol>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">{layout.map((k) => widgets[k])}</div>
    </>
  );
}
