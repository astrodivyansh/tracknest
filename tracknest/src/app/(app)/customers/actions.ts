"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { checkouts, customers } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { allow } from "@/lib/permissions";
import { CustodyError } from "@/lib/custody";
import { fields, handle, optText, reqText, type FormState } from "@/lib/form";

const customerSchema = z.object({
  name: reqText("Name"),
  company: optText,
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => v || null),
  phone: optText,
  address: optText,
  notes: optText,
});

export async function addCustomer(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "people");
    const input = customerSchema.parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(customers).values({ orgId: user.orgId, ...input }));
    revalidatePath("/customers");
    return { ok: `${input.name} added.` };
  });
}

// Past leases keep the name they were made with, so editing a customer never rewrites history.
export async function updateCustomer(customerId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "people");
    const input = customerSchema.parse(fields(form));
    const [c] = await withOrg(user.orgId, (tx) =>
      tx.update(customers).set(input).where(and(eq(customers.id, customerId), isNull(customers.deletedAt))).returning(),
    );
    if (!c) throw new CustodyError("Customer not found.");
    revalidatePath(`/customers/${customerId}`);
    return { ok: "Saved." };
  });
}

/** Hides a former customer; their lease history stays. Leased assets must come back first. */
export async function archiveCustomer(customerId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "people");
    await withOrg(user.orgId, async (tx) => {
      const [leased] = await tx
        .select({ n: count() })
        .from(checkouts)
        .where(and(eq(checkouts.holderType, "customer"), eq(checkouts.holderId, customerId), eq(checkouts.state, "open")));
      if (leased.n > 0) throw new CustodyError(`They still lease ${leased.n} asset(s). Return those first.`);
      await tx.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, customerId));
    });
    redirect("/customers");
  });
}
