import Link from "next/link";
import { and, asc, count, eq, isNull, lt } from "drizzle-orm";
import { withOrg } from "@/db";
import { assets, checkouts } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/custody";
import { describeEvent, fmtDate, fmtDateTime } from "@/lib/format";
import { listEvents } from "@/lib/history";
import { card, h1, h2, td, th } from "@/lib/ui";

export default async function Dashboard() {
  const user = await requireUser();
  const tz = user.timezone;
  const { byStatus, overdue, recent } = await withOrg(user.orgId, async (tx) => ({
    byStatus: await tx
      .select({ status: assets.status, n: count() })
      .from(assets)
      .where(isNull(assets.deletedAt))
      .groupBy(assets.status),
    overdue: await tx
      .select({
        assetId: assets.id,
        tag: assets.tag,
        name: assets.name,
        holder: checkouts.holderName,
        dueAt: checkouts.dueAt,
      })
      .from(checkouts)
      .innerJoin(assets, eq(assets.id, checkouts.assetId))
      .where(and(eq(checkouts.state, "open"), lt(checkouts.dueAt, new Date())))
      .orderBy(asc(checkouts.dueAt))
      .limit(20),
    recent: await listEvents(tx, {}, tz, 10),
  }));
  const total = byStatus.reduce((s, r) => s + r.n, 0);
  const n = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;

  const stats = [
    { label: "Total assets", value: total, href: "/assets" },
    { label: "Available", value: n("available"), href: "/assets?status=available" },
    { label: "Checked out", value: n("checked_out"), href: "/assets?status=checked_out" },
    { label: "Overdue", value: overdue.length, href: "#overdue" },
  ];

  return (
    <>
      <h1 className={h1}>Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className={`${card} hover:border-indigo-300`}>
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className="text-3xl font-semibold text-gray-900">{s.value}</p>
          </Link>
        ))}
      </div>
      {total === 0 && (
        <section className={card}>
          <h2 className={h2}>Get started</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
            <li>
              <Link href="/setup" className="text-indigo-600 hover:underline">Add a site, locations and categories</Link>
            </li>
            <li>
              <Link href="/people" className="text-indigo-600 hover:underline">Add the people who hold assets</Link>
            </li>
            <li>
              <Link href="/assets/new" className="text-indigo-600 hover:underline">Add your first asset</Link> and check it out
            </li>
          </ol>
        </section>
      )}

      <section id="overdue" className="space-y-2">
        <h2 className={h2}>Overdue returns</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>Asset</th>
                <th className={th}>Held by</th>
                <th className={th}>Was due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {overdue.map((o) => (
                <tr key={o.assetId}>
                  <td className={td}>
                    <Link href={`/assets/${o.assetId}`} className="font-mono text-indigo-600 hover:underline">
                      {o.tag}
                    </Link>{" "}
                    {o.name}
                  </td>
                  <td className={td}>{o.holder}</td>
                  <td className={`${td} text-red-700`}>{fmtDate(o.dueAt, tz)}</td>
                </tr>
              ))}
              {overdue.length === 0 && (
                <tr>
                  <td colSpan={3} className={`${td} text-gray-500`}>
                    Nothing overdue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <div className="flex items-center justify-between">
          <h2 className={h2}>Recent activity</h2>
          <Link href="/history" className="text-sm text-indigo-600 hover:underline">
            Full history
          </Link>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {recent.map((e) => (
            <li key={e.id}>
              <span className="font-mono text-gray-500">{e.assetTag}</span> {describeEvent(e, tz)}
              <span className="text-xs text-gray-500"> · {fmtDateTime(e.occurredAt, tz)} · {e.actorName}</span>
            </li>
          ))}
          {recent.length === 0 && <li className="text-gray-500">No activity yet.</li>}
        </ul>
        {byStatus.length > 0 && (
          <p className="mt-4 text-xs text-gray-500">
            {byStatus.map((r) => `${STATUS_LABEL[r.status]}: ${r.n}`).join(" · ")}
          </p>
        )}
      </section>
    </>
  );
}
