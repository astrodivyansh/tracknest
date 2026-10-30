"use server";

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { organizations, passwordResets, sessions, users } from "@/db/schema";
import {
  appOrigin,
  clearLoginFailures,
  clientIp,
  endSession,
  hashPassword,
  isLoginBlocked,
  passesTwoStep,
  recordLoginFailure,
  sha256,
  startSession,
  verifyPassword,
} from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { fields, handle, reqText, type FormState } from "@/lib/form";
import { redeemInvite } from "@/lib/invites";
import { sendMail } from "@/lib/mail";

const dummyHash = hashPassword("not-a-real-password");

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
    redirect("/wizard");
  });
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = await clientIp();
  if (await isLoginBlocked(email, ip)) {
    return { error: "Too many failed sign-in attempts. Wait 15 minutes and try again." };
  }
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  // Hash even for unknown emails so response time doesn't reveal which accounts exist.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) {
    await recordLoginFailure(email, ip);
    return { error: "Wrong email or password." };
  }
  const code = String(form.get("code") ?? "");
  if (!(await passesTwoStep(user, code))) {
    if (!code) return { error: "Two-step sign-in is on for this account. Enter the 6-digit code from your authenticator app." };
    await recordLoginFailure(email, ip);
    return { error: "That code didn't work. Enter the current 6-digit code from your authenticator app." };
  }
  await clearLoginFailures(email);
  await startSession(user.id);
  redirect("/dashboard");
}

export async function acceptInvite(token: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const input = z
      .object({ name: reqText("Your name"), password: z.string().min(8, "Password must be at least 8 characters") })
      .parse(fields(form));
    const userId = await redeemInvite(token, { name: input.name, passwordHash: await hashPassword(input.password) });
    await startSession(userId);
    redirect("/dashboard");
  });
}

const RESET_MINUTES = 60;
const MAX_RESETS_PER_HOUR = 3;

/** Same answer whether or not the email has an account, so it can't be used to find accounts. */
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const { email } = z.object({ email: z.email("Enter a valid email").trim().toLowerCase() }).parse(fields(form));
    const done = { ok: `If ${email} has an account, we've emailed a link to reset the password. It works for ${RESET_MINUTES} minutes.` };
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (!user) return done;
    const [recent] = await db
      .select({ n: count() })
      .from(passwordResets)
      .where(and(eq(passwordResets.userId, user.id), gt(passwordResets.createdAt, new Date(Date.now() - 3600_000))));
    if (recent.n >= MAX_RESETS_PER_HOUR) return done; // stops the form being used to flood someone's inbox

    const token = randomBytes(32).toString("base64url");
    await db
      .insert(passwordResets)
      .values({ id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) });
    await sendMail({
      to: user.email,
      subject: "Reset your TrackNest password",
      text: `Hi ${user.name},\n\nSomeone asked to reset your TrackNest password. If it was you, choose a new password here (the link works once, for ${RESET_MINUTES} minutes):\n${await appOrigin()}/reset-password/${token}\n\nIf it wasn't you, ignore this email. Your password stays the same.\n`,
    });
    return done;
  });
}

export async function resetPassword(token: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const { password } = z
      .object({ password: z.string().min(8, "Password must be at least 8 characters") })
      .parse(fields(form));
    const passwordHash = await hashPassword(password);
    const user = await db.transaction(async (tx) => {
      const [reset] = await tx
        .select()
        .from(passwordResets)
        .where(and(eq(passwordResets.id, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
        .for("update");
      if (!reset) throw new CustodyError("This reset link is invalid, expired or already used. Ask for a new one.");
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
      const [u] = await tx.update(users).set({ passwordHash }).where(eq(users.id, reset.userId)).returning();
      await tx.delete(sessions).where(eq(sessions.userId, u.id)); // sign out everywhere, in case the old password leaked
      return u;
    });
    await clearLoginFailures(user.email.toLowerCase());
    // A reset link proves the email, not the authenticator: two-step users still sign in with their code.
    if (user.totpEnabled) redirect(`/login?error=${encodeURIComponent("Password changed. Sign in with it and your authenticator code.")}`);
    await startSession(user.id);
    redirect("/dashboard");
  });
}

export async function logout() {
  await endSession();
  redirect("/login");
}
