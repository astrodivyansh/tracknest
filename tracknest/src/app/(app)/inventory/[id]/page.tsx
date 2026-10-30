import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { inventoryItems, inventoryMoves } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { getLookups } from "@/lib/lookups";
import { can } from "@/lib/permissions";
import { btn, btnSecondary, card, h1, h2, input, label, td, th } from "@/lib/ui";
import { archiveItem, moveStockAction, updateItem } from "../actions";

const KIND = { received: "Received", issued: "Issued", counted: "Counted" };

export default async function ItemPage({ params }: PageProps<"/inventory/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withOrg(user.orgId, async (tx) => {
    const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    if (!item) return null;
    return {
      item,
      moves: await tx.select().from(inventoryMoves).where(eq(inventoryMoves.itemId, id)).orderBy(desc(inventoryMoves.occurredAt)).limit(500),
      lookups: await getLookups(tx),
    };
  });
  if (!data) notFound();
  const { item: i, moves, lookups } = data;
  const editable = can(user, "inventory") && !i.archivedAt;

  return (
    <>
      <div>
        <Link href="/inventory" className="text-sm text-primary hover:underline">
          ← Inventory
        </Link>
        <h1 className={h1}>{i.name}</h1>
        <p className="text-sm text-muted-foreground">
          {Number(i.quantity)} {i.unit} in stock
          {i.minQuantity !== null && ` · alert at ${Number(i.minQuantity)}`}
          {i.unitCost && ` · ${fmtMoney(i.unitCost, user.currency)} each`}
          {i.sku && ` · ${i.sku}`}
          {i.archivedAt && " · Archived"}
        </p>
      </div>

      {editable && (
        <section className={card}>
          <h2 className={h2}>Stock movement</h2>
          <ActionForm action={moveStockAction.bind(null, id)} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
            <label className={label}>
              What happened
              <select name="kind" defaultValue="issued" className={input}>
                <option value="issued">Issued (stock goes down)</option>
                <option value="received">Received (stock goes up)</option>
                <option value="counted">Counted (set the true total)</option>
              </select>
            </label>
            <label className={label}>
              Quantity
              <input name="quantity" required inputMode="decimal" className={input} />
            </label>
            <label className={label}>
              Note
              <input name="note" placeholder="e.g. issued to Priya, invoice 123" className={input} />
            </label>
            <button className={btn}>Save</button>
          </ActionForm>
        </section>
      )}

      {editable && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Edit details</summary>
          <ActionForm action={updateItem.bind(null, id)} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            <label className={label}>
              Name
              <input name="name" required defaultValue={i.name} className={input} />
            </label>
            <label className={label}>
              SKU / code
              <input name="sku" defaultValue={i.sku ?? ""} className={input} />
            </label>
            <label className={label}>
              Unit
              <input name="unit" defaultValue={i.unit} className={input} />
            </label>
            <label className={label}>
              Alert at or below
              <input name="minQuantity" inputMode="decimal" defaultValue={i.minQuantity === null ? "" : Number(i.minQuantity)} className={input} />
            </label>
            <label className={label}>
              Unit cost
              <input name="unitCost" inputMode="decimal" defaultValue={i.unitCost === null ? "" : Number(i.unitCost)} className={input} />
            </label>
            <label className={label}>
              Location
              <select name="locationId" defaultValue={i.locationId ?? ""} className={input}>
                <option value="">—</option>
                {lookups.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.siteName} — {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${label} sm:col-span-2`}>
              Notes
              <input name="notes" defaultValue={i.notes ?? ""} className={input} />
            </label>
            <button className={btnSecondary}>Save</button>
          </ActionForm>
          <ActionForm action={archiveItem.bind(null, id)} className="mt-4 border-t border-border pt-3">
            <button className="text-sm text-red-600 hover:underline dark:text-red-400">Archive item (needs zero stock)</button>
          </ActionForm>
        </details>
      )}

      <section className="space-y-2">
        <h2 className={h2}>Movements</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th className={th}>When</th>
                <th className={th}>What</th>
                <th className={`${th} text-right`}>Change</th>
                <th className={`${th} text-right`}>Balance</th>
                <th className={th}>Note</th>
                <th className={th}>By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className={`${td} whitespace-nowrap`}>{fmtDateTime(m.occurredAt, user.timezone)}</td>
                  <td className={td}>{KIND[m.kind]}</td>
                  <td className={`${td} text-right`}>{Number(m.change) > 0 ? `+${Number(m.change)}` : Number(m.change)}</td>
                  <td className={`${td} text-right`}>{Number(m.balance)}</td>
                  <td className={td}>{m.note ?? "—"}</td>
                  <td className={td}>{m.actorName}</td>
                </tr>
              ))}
              {moves.length === 0 && (
                <tr>
                  <td colSpan={6} className={`${td} text-muted-foreground`}>
                    No movements yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
