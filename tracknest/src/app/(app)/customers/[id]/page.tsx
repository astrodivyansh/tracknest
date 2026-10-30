import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { customers } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { CustodyTable } from "@/components/custody-table";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { checkoutsFor } from "@/lib/history";
import { btn, btnSecondary, card, h1, h2, input, label } from "@/lib/ui";
import { archiveCustomer, updateCustomer } from "../actions";

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await withOrg(user.orgId, async (tx) => {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
    return customer ? { customer, rows: await checkoutsFor(tx, "customer", id) } : null;
  });
  if (!data) notFound();
  const { customer: c, rows } = data;
  const leased = rows.filter((r) => r.state === "open");
  const text = (name: "name" | "company" | "email" | "phone" | "address" | "notes", title: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={label}>
      {title}
      <input name={name} defaultValue={c[name] ?? ""} className={input} {...extra} />
    </label>
  );

  return (
    <>
      <div>
        <h1 className={h1}>{c.name}</h1>
        <p className="text-sm text-muted-foreground">{[c.company, c.email, c.phone, c.address].filter(Boolean).join(" · ") || "No details"}</p>
        {c.notes && <p className="mt-1 text-sm">{c.notes}</p>}
        {c.deletedAt && <p className="mt-2 inline-block rounded bg-muted px-2 py-0.5 text-xs text-foreground">Archived — kept for history only</p>}
      </div>
      {can(user, "people") && !c.deletedAt && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Edit details</summary>
          <ActionForm action={updateCustomer.bind(null, id)} className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
            {text("name", "Name", { required: true })}
            {text("company", "Company")}
            {text("email", "Email", { type: "email" })}
            {text("phone", "Phone", { type: "tel" })}
            {text("address", "Address")}
            {text("notes", "Notes")}
            <button className={btn}>Save</button>
          </ActionForm>
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-sm text-muted-foreground">No longer a customer? Archiving hides them from lists and leasing. Their history stays.</p>
            <ActionForm action={archiveCustomer.bind(null, id)}>
              <button className={btnSecondary}>Archive customer</button>
            </ActionForm>
          </div>
        </details>
      )}
      <section className="space-y-2">
        <h2 className={h2}>Leased now ({leased.length})</h2>
        <CustodyTable rows={leased} tz={user.timezone} />
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Every lease ({rows.length})</h2>
        <CustodyTable rows={rows} tz={user.timezone} />
      </section>
    </>
  );
}
