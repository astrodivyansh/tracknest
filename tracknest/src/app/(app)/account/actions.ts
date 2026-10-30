"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  canEdit,
  clearLoginFailures,
  clientIp,
  endOtherSessions,
  hashPassword,
  isLoginBlocked,
  passesTwoStep,
  recordLoginFailure,
  requireUser,
  verifyPassword,
} from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { fields, handle, reqText, type FormState } from "@/lib/form";
import { newSecret, verifyCode } from "@/lib/totp";

// users is a global table (no RLS); every update here is by the signed-in user's own id.

export async function updateName(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    const { name } = z.object({ name: reqText("Name").pipe(z.string().max(100)) }).parse(fields(form));
    await db.update(users).set({ name }).where(eq(users.id, user.id));
    revalidatePath("/", "layout");
    return { ok: "Name saved. New history entries use it; past entries keep the name they were made with." };
  });
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    const input = z
      .object({ current: z.string().min(1, "Enter your current password"), next: z.string().min(8, "New password must be at least 8 characters") })
      .parse(fields(form));
    // Same lockout as sign-in, so this form can't be used to guess a password on an unlocked laptop.
    const ip = await clientIp();
    if (await isLoginBlocked(user.email.toLowerCase(), ip)) throw new CustodyError("Too many wrong passwords. Wait 15 minutes and try again.");
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id));
    if (!(await verifyPassword(input.current, row.hash))) {
      await recordLoginFailure(user.email.toLowerCase(), ip);
      throw new CustodyError("Your current password is wrong. Signed up with Google? Use “Forgot password?” to set one.");
    }
    await db.update(users).set({ passwordHash: await hashPassword(input.next) }).where(eq(users.id, user.id));
    await clearLoginFailures(user.email.toLowerCase());
    await endOtherSessions(user.id);
    return { ok: "Password changed. You've been signed out on your other devices." };
  });
}

export async function toggleMyAlerts(): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    if (!canEdit(user)) throw new CustodyError("Daily alert emails are for managers and up.");
    const [row] = await db.select({ on: users.emailAlerts }).from(users).where(eq(users.id, user.id));
    await db.update(users).set({ emailAlerts: !row.on }).where(eq(users.id, user.id));
    revalidatePath("/account");
  });
}

export async function signOutOthers(): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    await endOtherSessions(user.id);
    return { ok: "Signed out on all other devices." };
  });
}

/** Step 1: a new secret to scan. Not active until a code from it is confirmed. */
export async function startTwoStep(): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    const [me] = await db.select({ on: users.totpEnabled }).from(users).where(eq(users.id, user.id));
    if (me.on) throw new CustodyError("Two-step sign-in is already on.");
    await db.update(users).set({ totpSecret: newSecret(), totpLastStep: null }).where(eq(users.id, user.id));
    revalidatePath("/account");
  });
}

/** Step 2: proves the app is set up, then turns it on. */
export async function confirmTwoStep(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    const [me] = await db.select().from(users).where(eq(users.id, user.id));
    if (!me.totpSecret || me.totpEnabled) throw new CustodyError("Start the set-up again.");
    const step = verifyCode(me.totpSecret, String(form.get("code") ?? ""));
    if (step === null) throw new CustodyError("That code didn't match. Check the time on your phone and try the newest code.");
    await db.update(users).set({ totpEnabled: true, totpLastStep: step }).where(eq(users.id, user.id));
    revalidatePath("/", "layout");
    return { ok: "Two-step sign-in is on. You'll need a code from the app each time you sign in." };
  });
}

/** Turns it off (or abandons a set-up); needs a current code when it's on. */
export async function disableTwoStep(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser();
    const ip = await clientIp();
    const email = user.email.toLowerCase();
    if (await isLoginBlocked(email, ip)) throw new CustodyError("Too many wrong codes. Wait 15 minutes and try again.");
    const [me] = await db.select().from(users).where(eq(users.id, user.id));
    if (me.totpEnabled && !(await passesTwoStep(me, String(form.get("code") ?? "")))) {
      await recordLoginFailure(email, ip);
      throw new CustodyError("That code didn't work. Enter the current code from your authenticator app.");
    }
    await db.update(users).set({ totpEnabled: false, totpSecret: null, totpLastStep: null }).where(eq(users.id, user.id));
    revalidatePath("/", "layout");
    return { ok: me.totpEnabled ? "Two-step sign-in is off." : "Set-up cancelled." };
  });
}
