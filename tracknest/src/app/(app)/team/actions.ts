"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys, invites, users } from "@/db/schema";
import { appOrigin, requireUser, sha256 } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { fields, handle, type FormState } from "@/lib/form";
import { sendMail } from "@/lib/mail";

// users and invites are global tables (no RLS), so every query here filters by org explicitly.
const INVITE_DAYS = 7;
const assignable = z.enum(["viewer", "manager", "admin"], "Pick a role");

export async function createInvite(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z
      .object({ email: z.email("Enter a valid email").trim().toLowerCase(), role: assignable })
      .parse(fields(form));
    const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
    if (existing) throw new CustodyError("Someone with that email already has an account.");

    const token = randomBytes(32).toString("base64url");
    await db.insert(invites).values({
      id: sha256(token),
      orgId: user.orgId,
      email: input.email,
      role: input.role,
      invitedBy: user.name,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5),
    });
    revalidatePath("/team");
    const link = `${await appOrigin()}/invite/${token}`;
    try {
      await sendMail({
        to: input.email,
        subject: `${user.name} invited you to ${user.orgName} on TrackNest`,
        text: `Hi,\n\n${user.name} invited you to join ${user.orgName} on TrackNest as ${input.role}.\n\nCreate your account here (the link works once and expires in ${INVITE_DAYS} days):\n${link}\n`,
      });
      return { ok: `Invite emailed to ${input.email}. You can also send them this link (valid ${INVITE_DAYS} days): ${link}` };
    } catch (e) {
      console.error("invite email failed", e);
      return { ok: `Invite created, but the email couldn't be sent. Send this link to ${input.email} yourself (valid ${INVITE_DAYS} days): ${link}` };
    }
  });
}

export async function revokeInvite(inviteId: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    await db.delete(invites).where(and(eq(invites.id, inviteId), eq(invites.orgId, user.orgId), isNull(invites.acceptedAt)));
    revalidatePath("/team");
  });
}

async function otherMember(orgId: string, selfId: string, userId: string) {
  if (userId === selfId) throw new CustodyError("You can't change your own access.");
  const [target] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId)));
  if (!target) throw new CustodyError("User not found.");
  if (target.role === "owner") throw new CustodyError("The owner's access can't be changed.");
  return target;
}

export async function changeRole(userId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const { role } = z.object({ role: assignable }).parse(fields(form));
    const target = await otherMember(user.orgId, user.id, userId);
    await db.update(users).set({ role }).where(eq(users.id, target.id));
    revalidatePath("/team");
    return { ok: `${target.name} is now ${role}.` };
  });
}

export async function removeUser(userId: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const target = await otherMember(user.orgId, user.id, userId);
    // Sessions cascade, so they're signed out at once. History keeps their name (actor_name snapshot).
    await db.delete(users).where(eq(users.id, target.id));
    revalidatePath("/team");
    return { ok: `${target.name} removed.` };
  });
}

export async function toggleAlerts(userId: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const [target] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.orgId, user.orgId)));
    if (!target) throw new CustodyError("User not found.");
    await db.update(users).set({ emailAlerts: !target.emailAlerts }).where(eq(users.id, target.id));
    revalidatePath("/team");
  });
}

/** The key is shown once; only its hash is stored. */
export async function createApiKey(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z
      .object({ name: z.string().trim().min(1, "Name the key, e.g. after the system using it").max(60), scope: z.enum(["read", "write"]) })
      .parse(fields(form));
    const key = `tn_${randomBytes(24).toString("base64url")}`;
    await db.insert(apiKeys).values({
      orgId: user.orgId,
      name: input.name,
      keyHash: sha256(key),
      prefix: key.slice(0, 10),
      scope: input.scope,
      createdBy: user.name,
    });
    revalidatePath("/team");
    return { ok: `Key created. Copy it now, it won't be shown again: ${key}` };
  });
}

export async function revokeApiKey(keyId: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, user.orgId), isNull(apiKeys.revokedAt)));
    revalidatePath("/team");
  });
}
