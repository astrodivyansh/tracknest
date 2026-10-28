import Link from "next/link";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { withOrg } from "@/db";
import { checkouts, departments, persons } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { canEdit, requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/lookups";
import { btn, card, h1, input, label, td, th } from "@/lib/ui";
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
      <p className="-mt-4 text-sm text-gray-600">Employees and others who can hold assets. They don&apos;t need a login.</p>

      {canEdit(user) && (
        <section className={card}>
          <ActionForm action={addPerson} className="grid gap-3 sm:grid-cols-5 sm:items-end">
            <label className={label}>
              Name
              <input name="name" required className={input} />
            </label>
            <label className={label}>
              Email
              <input name="email" type="email" className={input} />
            </label>
            <label className={label}>
              Employee ID
              <input name="employeeId" className={input} />
            </label>
            <label className={label}>
              Department
              <select name="departmentId" className={input}>
                <option value="">—</option>
                {lookups.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={btn}>Add person</button>
          </ActionForm>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Employee ID</th>
              <th className={th}>Department</th>
              <th className={th}>Email</th>
              <th className={th}>Holding now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className={td}>
                  <Link href={`/people/${p.id}`} className="font-medium text-indigo-600 hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className={td}>{p.employeeId ?? "—"}</td>
                <td className={td}>{p.department ?? "—"}</td>
                <td className={td}>{p.email ?? "—"}</td>
                <td className={td}>{p.holding}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={`${td} text-gray-500`}>
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
