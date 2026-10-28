"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOrg } from "@/db";
import { persons } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fields, handle, optId, optText, reqText, type FormState } from "@/lib/form";

export async function addPerson(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("manager");
    const input = z
      .object({
        name: reqText("Name"),
        email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => v || null),
        employeeId: optText,
        departmentId: optId,
      })
      .parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(persons).values({ orgId: user.orgId, ...input }));
    revalidatePath("/people");
    return { ok: `${input.name} added.` };
  });
}
