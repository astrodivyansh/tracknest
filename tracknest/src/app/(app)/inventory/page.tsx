import Link from "next/link";
import { asc, eq, isNull } from "drizzle-orm";
import { withOrg } from "@/db";
import { inventoryItems, locations } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { fmtMoney } from "@/lib/format";
import { getLookups } from "@/lib/lookups";
import { can } from "@/lib/permissions";
import { btn, card, h1, input, label, td, th } from "@/lib/ui";
import { addItem } from "./actions";

export default async function InventoryPage() {
  const user = await requireUser();
  const { rows, lookups } = await withOrg(user.orgId, async (tx) => ({
    rows: await tx
      .select({ i: inventoryItems, location: locations.name })
      .from(inventoryItems)
      .leftJoin(locations, eq(locations.id, inventoryItems.locationId))
      .where(isNull(inventoryItems.archivedAt))
      .orderBy(asc(inventoryItems.name)),
    lookups: await getLookups(tx),
  }));

  return (
    <>
      <h1 className={h1}>Inventory</h1>
      <p className="-mt-4 text-sm text-muted-foreground">Consumable stock counted in bulk, such as toner or cables. Every movement is kept.</p>

      {can(user, "inventory") && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Add an item</summary>
          <ActionForm action={addItem} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
            <label className={label}>
              Name
              <input name="name" required className={input} />
            </label>
            <label className={label}>
              SKU / code
              <input name="sku" className={input} />
            </label>
            <label className={label}>
              Unit
              <input name="unit" placeholder="pcs" className={input} />
            </label>
            <label className={label}>
              Opening stock
              <input name="opening" inputMode="decimal" className={input} />
            </label>
            <label className={label}>
              Alert at or below
              <input name="minQuantity" inputMode="decimal" className={input} />
            </label>
            <label className={label}>
              Unit cost
              <input name="unitCost" inputMode="decimal" className={input} />
            </label>
            <label className={label}>
              Location
              <select name="locationId" defaultValue="" className={input}>
                <option value="">—</option>
                {lookups.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.siteName} — {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={btn}>Add item</button>
          </ActionForm>
        </details>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Item</th>
              <th className={th}>SKU</th>
              <th className={th}>Location</th>
              <th className={`${th} text-right`}>In stock</th>
              <th className={`${th} text-right`}>Alert level</th>
              <th className={`${th} text-right`}>Stock value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ i, location }) => {
              const low = i.minQuantity !== null && Number(i.quantity) <= Number(i.minQuantity);
              return (
                <tr key={i.id}>
                  <td className={td}>
                    <Link href={`/inventory/${i.id}`} className="font-medium text-primary hover:underline">
                      {i.name}
                    </Link>
                  </td>
                  <td className={td}>{i.sku ?? "—"}</td>
                  <td className={td}>{location ?? "—"}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    {Number(i.quantity)} {i.unit}
                    {low && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-400">Low</span>}
                  </td>
                  <td className={`${td} text-right`}>{i.minQuantity === null ? "—" : Number(i.minQuantity)}</td>
                  <td className={`${td} text-right`}>{i.unitCost ? fmtMoney(Number(i.quantity) * Number(i.unitCost), user.currency) : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className={`${td} text-muted-foreground`}>
                  No items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
