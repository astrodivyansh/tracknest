"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { checkouts, persons, WORK_LOCATIONS } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { allow } from "@/lib/permissions";
import { CustodyError } from "@/lib/custody";
import { fields, handle, optId, optText, reqText, type FormState } from "@/lib/form";

const personSchema = z.object({
  name: reqText("Name"),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => v || null),
  employeeId: optText,
  departmentId: optId,
  brand: optText,
  designation: optText,
  workLocation: z.union([z.literal(""), z.enum(WORK_LOCATIONS)]).optional().transform((v) => v || null),
});

export async function addPerson(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "people");
    const input = personSchema.parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(persons).values({ orgId: user.orgId, ...input }));
    revalidatePath("/people");
    return { ok: `${input.name} added.` };
  });
}

// Past check-outs keep the holder name they were made with, so editing a person never rewrites history.
export async function updatePerson(personId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "people");
    const input = personSchema.parse(fields(form));
    const [p] = await withOrg(user.orgId, (tx) =>
      tx.update(persons).set(input).where(and(eq(persons.id, personId), isNull(persons.deletedAt))).returning(),
    );
    if (!p) throw new CustodyError("Person not found.");
    revalidatePath(`/people/${personId}`);
    return { ok: "Saved." };
  });
}

/** Hides someone who has left; their custody history stays. They must return everything first. */
export async function archivePerson(personId: string): Promise<FormState> {
  return handle(async () => {
    const user = allow(await requireUser("manager"), "people");
    await withOrg(user.orgId, async (tx) => {
      const [holding] = await tx
        .select({ n: count() })
        .from(checkouts)
        .where(and(eq(checkouts.holderType, "person"), eq(checkouts.holderId, personId), eq(checkouts.state, "open")));
      if (holding.n > 0) throw new CustodyError(`They still hold ${holding.n} asset(s). Check those in first.`);
      await tx.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, personId));
    });
    redirect("/people");
  });
}
