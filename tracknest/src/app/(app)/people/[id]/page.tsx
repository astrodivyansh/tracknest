import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assets, checkouts, departments, persons } from "@/db/schema";
import { CustodyTable } from "@/components/custody-table";
import { requireUser } from "@/lib/auth";
import { h1, h2 } from "@/lib/ui";

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await withOrg(user.orgId, async (tx) => {
    const [person] = await tx
      .select({ name: persons.name, email: persons.email, employeeId: persons.employeeId, department: departments.name })
      .from(persons)
      .leftJoin(departments, eq(departments.id, persons.departmentId))
      .where(eq(persons.id, id));
    if (!person) return null;
    const rows = await tx
      .select({
        id: checkouts.id,
        assetId: assets.id,
        assetTag: assets.tag,
        assetName: assets.name,
        holderName: checkouts.holderName,
        checkedOutAt: checkouts.checkedOutAt,
        dueAt: checkouts.dueAt,
        checkedInAt: checkouts.checkedInAt,
        outCondition: checkouts.outCondition,
        inCondition: checkouts.inCondition,
        state: checkouts.state,
        overdue: sql<boolean>`${checkouts.state} = 'open' and ${checkouts.dueAt} < now()`,
      })
      .from(checkouts)
      .innerJoin(assets, eq(assets.id, checkouts.assetId))
      .where(and(eq(checkouts.holderType, "person"), eq(checkouts.holderId, id)))
      .orderBy(desc(checkouts.checkedOutAt));
    return { person, rows };
  });
  if (!data) notFound();
  const { person, rows } = data;
  const holding = rows.filter((r) => r.state === "open");

  return (
    <>
      <div>
        <h1 className={h1}>{person.name}</h1>
        <p className="text-sm text-gray-600">
          {[person.employeeId, person.department, person.email].filter(Boolean).join(" · ") || "No details"}
        </p>
      </div>
      <section className="space-y-2">
        <h2 className={h2}>Holding now ({holding.length})</h2>
        <CustodyTable rows={holding} tz={user.timezone} />
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Every asset ever held ({rows.length})</h2>
        <CustodyTable rows={rows} tz={user.timezone} />
      </section>
    </>
  );
}
