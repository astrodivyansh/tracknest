import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { inventoryItems, inventoryMoves } from "@/db/schema";
import { CustodyError, type Actor } from "./custody";

/**
 * Records stock coming in, going out, or a physical count (`quantity` is then the new total).
 * The row lock stops two people issuing the same last unit.
 */
export async function moveStock(
  tx: Tx,
  actor: Actor,
  input: { itemId: string; kind: "received" | "issued" | "counted"; quantity: number; note?: string | null },
) {
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, input.itemId)).for("update");
  if (!item || item.archivedAt) throw new CustodyError("Item not found.");
  if (input.quantity < 0 || (input.kind !== "counted" && input.quantity === 0)) throw new CustodyError("Enter a quantity above zero.");
  const now = Number(item.quantity);
  const balance = input.kind === "received" ? now + input.quantity : input.kind === "issued" ? now - input.quantity : input.quantity;
  if (balance < 0) throw new CustodyError(`Only ${now} ${item.unit} of ${item.name} in stock.`);
  await tx.update(inventoryItems).set({ quantity: balance.toFixed(2) }).where(eq(inventoryItems.id, item.id));
  await tx.insert(inventoryMoves).values({
    orgId: actor.orgId,
    itemId: item.id,
    kind: input.kind,
    change: (balance - now).toFixed(2),
    balance: balance.toFixed(2),
    note: input.note || null,
    actorName: actor.name,
  });
  return balance;
}
