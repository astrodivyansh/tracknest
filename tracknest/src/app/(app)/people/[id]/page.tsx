import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { departments, persons } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { CustodyTable } from "@/components/custody-table";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { checkoutsFor } from "@/lib/history";
import { getLookups } from "@/lib/lookups";
import { btn, btnSecondary, card, h1, h2, input, label } from "@/lib/ui";
import { archivePerson, updatePerson } from "../actions";

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await withOrg(user.orgId, async (tx) => {
    const [person] = await tx
      .select({
        name: persons.name,
        email: persons.email,
        employeeId: persons.employeeId,
        departmentId: persons.departmentId,
        department: departments.name,
        archived: persons.deletedAt,
      })
      .from(persons)
      .leftJoin(departments, eq(departments.id, persons.departmentId))
      .where(eq(persons.id, id));
    if (!person) return null;
    const rows = await checkoutsFor(tx, "person", id);
    return { person, rows, lookups: await getLookups(tx) };
  });
  if (!data) notFound();
  const { person, rows, lookups } = data;
  const holding = rows.filter((r) => r.state === "open");

  return (
    <>
      <div>
        <h1 className={h1}>{person.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[person.employeeId, person.email].filter(Boolean).join(" · ") || "No details"}
          {person.departmentId && (
            <>
              {" · "}
              <Link href={`/departments/${person.departmentId}`} className="text-primary hover:underline">
                {person.department}
              </Link>
            </>
          )}
        </p>
        {person.archived && (
          <p className="mt-2 inline-block rounded bg-muted px-2 py-0.5 text-xs text-foreground">Archived — kept for history only</p>
        )}
      </div>
      {can(user, "people") && !person.archived && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Edit details</summary>
          <ActionForm action={updatePerson.bind(null, id)} className="mt-4 grid gap-3 sm:grid-cols-5 sm:items-end">
            <label className={label}>
              Name
              <input name="name" required defaultValue={person.name} className={input} />
            </label>
            <label className={label}>
              Email
              <input name="email" type="email" defaultValue={person.email ?? ""} className={input} />
            </label>
            <label className={label}>
              Employee ID
              <input name="employeeId" defaultValue={person.employeeId ?? ""} className={input} />
            </label>
            <label className={label}>
              Department
              <select name="departmentId" defaultValue={person.departmentId ?? ""} className={input}>
                <option value="">—</option>
                {lookups.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={btn}>Save</button>
          </ActionForm>
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-sm text-muted-foreground">
              Has this person left? Archiving hides them from lists and check-out. Their history stays.
            </p>
            <ActionForm action={archivePerson.bind(null, id)}>
              <button className={btnSecondary}>Archive person</button>
            </ActionForm>
          </div>
        </details>
      )}
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
