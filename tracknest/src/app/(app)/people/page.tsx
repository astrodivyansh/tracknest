import Link from "next/link";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { withOrg } from "@/db";
import { checkouts, departments, persons, WORK_LOCATION_LABEL } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getLookups } from "@/lib/lookups";
import { PersonFields } from "@/components/person-fields";
import { btn, card, h1, td, th } from "@/lib/ui";
import { addPerson } from "./actions";

export default async function PeoplePage() {
  const user = await requireUser();
  const { rows, lookups } = await withOrg(user.orgId, async (tx) => ({
    rows: await tx
      .select({
        id: persons.id,
        name: persons.name,
        email: persons.email,
        employeeId: persons.employeeId,
        designation: persons.designation,
        brand: persons.brand,
        workLocation: persons.workLocation,
        department: departments.name,
        holding: count(checkouts.id),
      })
      .from(persons)
      .leftJoin(departments, eq(departments.id, persons.departmentId))
      .leftJoin(
        checkouts,
        and(eq(checkouts.holderId, persons.id), eq(checkouts.holderType, "person"), eq(checkouts.state, "open")),
      )
      .where(isNull(persons.deletedAt))
      .groupBy(persons.id, departments.name)
      .orderBy(asc(persons.name)),
    lookups: await getLookups(tx),
  }));

  return (
    <>
      <h1 className={h1}>People</h1>
      <p className="-mt-4 text-sm text-muted-foreground">Employees and others who can hold assets. They don&apos;t need a login.</p>

      {can(user, "people") && (
        <section className={card}>
          <ActionForm action={addPerson} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <PersonFields lookups={lookups} />
            <button className={btn}>Add person</button>
          </ActionForm>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Employee ID</th>
              <th className={th}>Designation</th>
              <th className={th}>Brand</th>
              <th className={th}>Department</th>
              <th className={th}>Work location</th>
              <th className={th}>Email</th>
              <th className={th}>Holding now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className={td}>
                  <Link href={`/people/${p.id}`} className="font-medium text-primary hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className={td}>{p.employeeId ?? "—"}</td>
                <td className={td}>{p.designation ?? "—"}</td>
                <td className={td}>{p.brand ?? "—"}</td>
                <td className={td}>{p.department ?? "—"}</td>
                <td className={td}>{p.workLocation ? WORK_LOCATION_LABEL[p.workLocation] : "—"}</td>
                <td className={td}>{p.email ?? "—"}</td>
                <td className={td}>{p.holding}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className={`${td} text-muted-foreground`}>
                  No people yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
