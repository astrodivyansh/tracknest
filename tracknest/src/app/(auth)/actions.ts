"use server";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { endSession, hashPassword, startSession, verifyPassword } from "@/lib/auth";
import { fields, handle, reqText, type FormState } from "@/lib/form";

const signupSchema = z.object({
  orgName: reqText("Organization name"),
  name: reqText("Your name"),
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  currency: z.string().length(3),
  timezone: z.string().min(1),
});

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const input = signupSchema.parse(fields(form));
    const passwordHash = await hashPassword(input.password);
    const userId = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: input.orgName, currency: input.currency, timezone: input.timezone })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({ orgId: org.id, name: input.name, email: input.email, passwordHash, role: "owner" })
        .returning();
      return user.id;
    });
    await startSession(userId);
    redirect("/dashboard");
  });
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Wrong email or password." };
  }
  await startSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
