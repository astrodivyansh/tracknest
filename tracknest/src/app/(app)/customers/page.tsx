import Link from "next/link";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { withOrg } from "@/db";
import { checkouts, customers } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { btn, card, h1, input, label, td, th } from "@/lib/ui";
import { addCustomer } from "./actions";

export default async function CustomersPage() {
  const user = await requireUser();
  const rows = await withOrg(user.orgId, (tx) =>
    tx
      .select({ id: customers.id, name: customers.name, company: customers.company, email: customers.email, phone: customers.phone, leased: count(checkouts.id) })
      .from(customers)
      .leftJoin(checkouts, and(eq(checkouts.holderId, customers.id), eq(checkouts.holderType, "customer"), eq(checkouts.state, "open")))
      .where(isNull(customers.deletedAt))
      .groupBy(customers.id)
      .orderBy(asc(customers.name)),
  );

  return (
    <>
      <h1 className={h1}>Customers</h1>
      <p className="-mt-4 text-sm text-muted-foreground">
        People or companies you lease assets to. To lease an asset, check it out to a customer; checking it in is the lease return.
      </p>

      {can(user, "people") && (
        <section className={card}>
          <ActionForm action={addCustomer} className="grid gap-3 sm:grid-cols-5 sm:items-end">
            <label className={label}>
              Name
              <input name="name" required className={input} />
            </label>
            <label className={label}>
              Company
              <input name="company" className={input} />
            </label>
            <label className={label}>
              Email
              <input name="email" type="email" className={input} />
            </label>
            <label className={label}>
              Phone
              <input name="phone" type="tel" className={input} />
            </label>
            <button className={btn}>Add customer</button>
          </ActionForm>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Company</th>
              <th className={th}>Email</th>
              <th className={th}>Phone</th>
              <th className={th}>Leased now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className={td}>
                  <Link href={`/customers/${c.id}`} className="font-medium text-primary hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className={td}>{c.company ?? "—"}</td>
                <td className={td}>{c.email ?? "—"}</td>
                <td className={td}>{c.phone ?? "—"}</td>
                <td className={td}>{c.leased}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={`${td} text-muted-foreground`}>
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
