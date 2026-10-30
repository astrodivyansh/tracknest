import { and, asc, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { withOrg } from "@/db";
import { assets, maintenance } from "@/db/schema";
import { MaintenanceList } from "@/components/maintenance-list";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtMoney } from "@/lib/format";
import { jobFields, todayIn } from "@/lib/maintenance";
import { card, h1, h2 } from "@/lib/ui";

export default async function MaintenancePage() {
  const user = await requireUser();
  const tz = user.timezone;
  const asset = { assetId: assets.id, assetTag: assets.tag, assetName: assets.name };

  const { open, closed, spend } = await withOrg(user.orgId, async (tx) => ({
    // shortcut: open jobs are listed in full; add paging if an org keeps thousands scheduled.
    open: await tx
      .select({ ...jobFields(tz), ...asset })
      .from(maintenance)
      .innerJoin(assets, eq(assets.id, maintenance.assetId))
      .where(inArray(maintenance.state, ["scheduled", "in_progress"]))
      .orderBy(sql`${maintenance.dueDate} asc nulls last`, asc(maintenance.createdAt)),
    closed: await tx
      .select({ ...jobFields(tz), ...asset })
      .from(maintenance)
      .innerJoin(assets, eq(assets.id, maintenance.assetId))
      .where(inArray(maintenance.state, ["completed", "cancelled"]))
      .orderBy(desc(maintenance.closedAt))
      .limit(50),
    spend: (
      await tx
        .select({ total: sum(maintenance.cost) })
        .from(maintenance)
        .where(
          and(
            eq(maintenance.state, "completed"),
            gte(maintenance.closedAt, sql`date_trunc('year', ${todayIn(tz)})::timestamp at time zone ${tz}`),
          ),
        )
    )[0].total,
  }));

  const inProgress = open.filter((j) => j.state === "in_progress");
  const overdue = open.filter((j) => j.overdue);
  const upcoming = open.filter((j) => j.state === "scheduled" && !j.overdue);
  const editable = can(user, "maintenance");

  return (
    <>
      <div>
        <h1 className={h1}>Maintenance</h1>
        <p className="text-sm text-muted-foreground">Schedule a job from an asset’s page. Repeating jobs schedule their next date when completed.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Overdue", overdue.length],
          ["In progress", inProgress.length],
          ["Upcoming", upcoming.length],
          ["Spend this year", fmtMoney(spend ?? 0, user.currency)],
        ].map(([k, v]) => (
          <div key={k} className={card}>
            <p className="text-sm text-muted-foreground">{k}</p>
            <p className="text-2xl font-semibold text-foreground">{v}</p>
          </div>
        ))}
      </div>
      {[
        { title: "Overdue", jobs: overdue, empty: "Nothing overdue." },
        { title: "In progress", jobs: inProgress, empty: "No assets are in maintenance." },
        { title: "Upcoming", jobs: upcoming, empty: "Nothing scheduled." },
        { title: "Recently closed", jobs: closed, empty: "No completed jobs yet." },
      ].map((sec) => (
        <section key={sec.title} className="space-y-2">
          <h2 className={h2}>{sec.title}</h2>
          <MaintenanceList jobs={sec.jobs} canEdit={editable} currency={user.currency} showAsset empty={sec.empty} />
        </section>
      ))}
    </>
  );
}
