import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assets, departments, persons } from "@/db/schema";
import { AssetList } from "@/components/asset-list";
import { CustodyTable } from "@/components/custody-table";
import { requireUser } from "@/lib/auth";
import { checkoutsFor } from "@/lib/history";
import { h1, h2 } from "@/lib/ui";

export default async function DepartmentPage({ params }: PageProps<"/departments/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withOrg(user.orgId, async (tx) => {
    const [dept] = await tx.select({ name: departments.name }).from(departments).where(eq(departments.id, id));
    if (!dept) return null;
    return {
      dept,
      assigned: await tx
        .select({ id: assets.id, tag: assets.tag, name: assets.name, status: assets.status })
        .from(assets)
        .where(and(eq(assets.departmentId, id), isNull(assets.deletedAt), ne(assets.status, "disposed")))
        .orderBy(asc(assets.tag)),
      people: await tx
        .select({ id: persons.id, name: persons.name })
        .from(persons)
        .where(and(eq(persons.departmentId, id), isNull(persons.deletedAt)))
        .orderBy(asc(persons.name)),
      rows: await checkoutsFor(tx, "department", id),
    };
  });
  if (!data) notFound();
  const holding = data.rows.filter((r) => r.state === "open");

  return (
    <>
      <div>
        <Link href="/setup" className="text-sm text-primary hover:underline">
          ← Setup
        </Link>
        <h1 className={h1}>{data.dept.name}</h1>
        <p className="text-sm text-muted-foreground">
          Department ·{" "}
          {data.people.length === 0
            ? "no people yet"
            : data.people.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link href={`/people/${p.id}`} className="text-primary hover:underline">
                    {p.name}
                  </Link>
                </span>
              ))}
        </p>
      </div>
      <section className="space-y-2">
        <h2 className={h2}>Assigned to this department ({data.assigned.length})</h2>
        <AssetList rows={data.assigned} empty="No assets are assigned to this department." />
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Checked out to this department now ({holding.length})</h2>
        <CustodyTable rows={holding} tz={user.timezone} />
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Every check-out to this department ({data.rows.length})</h2>
        <CustodyTable rows={data.rows} tz={user.timezone} />
      </section>
    </>
  );
}
