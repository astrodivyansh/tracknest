"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { inventoryItems, STOCK_MOVES } from "@/db/schema";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { fields, handle, optId, optText, reqText, type FormState } from "@/lib/form";
import { moveStock } from "@/lib/inventory";
import { allow } from "@/lib/permissions";

const actorOf = (u: CurrentUser) => ({ id: u.id, name: u.name, orgId: u.orgId });
const optNumber = (label: string) =>
  z
    .union([z.literal(""), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, `${label} must be a number like 12.50`)])
    .optional()
    .transform((v) => (v ? Number(v).toFixed(2) : null));

const itemSchema = z.object({
  name: reqText("Name"),
  sku: optText,
  unit: z.string().trim().max(20).optional().transform((v) => v || "pcs"),
  minQuantity: optNumber("Alert level"),
  unitCost: optNumber("Unit cost"),
  locationId: optId,
  notes: optText,
});

export async function addItem(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "inventory");
    const input = itemSchema.parse(fields(form));
    const opening = optNumber("Opening stock").parse(form.get("opening") ?? "");
    await withOrg(user.orgId, async (tx) => {
      const [item] = await tx.insert(inventoryItems).values({ orgId: user.orgId, ...input }).returning();
      if (Number(opening) > 0) await moveStock(tx, actorOf(user), { itemId: item.id, kind: "received", quantity: Number(opening), note: "Opening stock" });
    });
    revalidatePath("/inventory");
    return { ok: `${input.name} added.` };
  });
}

export async function updateItem(itemId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "inventory");
    const input = itemSchema.parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.update(inventoryItems).set(input).where(eq(inventoryItems.id, itemId)));
    revalidatePath(`/inventory/${itemId}`);
    return { ok: "Saved." };
  });
}

export async function moveStockAction(itemId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "inventory");
    const input = z
      .object({
        kind: z.enum(STOCK_MOVES),
        quantity: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Quantity must be a number like 5 or 2.5").transform(Number),
        note: optText,
      })
      .parse(fields(form));
    const balance = await withOrg(user.orgId, (tx) => moveStock(tx, actorOf(user), { itemId, ...input }));
    revalidatePath("/", "layout");
    return { ok: `Done. Stock is now ${balance}.` };
  });
}

/** Hides an item no longer stocked; its movements stay. */
export async function archiveItem(itemId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "inventory");
    await withOrg(user.orgId, async (tx) => {
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
      if (Number(item?.quantity) > 0) throw new CustodyError("There's still stock. Issue it or count it to zero first.");
      await tx.update(inventoryItems).set({ archivedAt: new Date() }).where(eq(inventoryItems.id, itemId));
    });
    redirect("/inventory");
  });
}
