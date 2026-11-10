"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg } from "@/db";
import { securityGroups, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { fields, handle, optId, reqText, type FormState } from "@/lib/form";
import { ACTION_KEYS } from "@/lib/permissions";

const permsOf = (form: FormData) => ACTION_KEYS.filter((a) => form.getAll("perm").includes(a));

export async function addGroup(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const { name } = z.object({ name: reqText("Group name") }).parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.insert(securityGroups).values({ orgId: user.orgId, name, permissions: permsOf(form) }));
    revalidatePath("/setup/groups");
    return { ok: `Group “${name}” added. Assign people to it under Team.` };
  });
}

export async function updateGroup(id: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const { name } = z.object({ name: reqText("Group name") }).parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.update(securityGroups).set({ name, permissions: permsOf(form) }).where(eq(securityGroups.id, id)));
    revalidatePath("/setup/groups");
    return { ok: "Saved." };
  });
}

export async function removeGroup(id: string): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const [inUse] = await db.select({ id: users.id }).from(users).where(and(eq(users.orgId, user.orgId), eq(users.groupId, id), isNull(users.deletedAt))).limit(1);
    if (inUse) throw new CustodyError("Move its members to another group (or none) first.");
    await withOrg(user.orgId, (tx) => tx.delete(securityGroups).where(eq(securityGroups.id, id)));
    revalidatePath("/setup/groups");
  });
}

/** Admins and owners always have every permission, so only managers can be put in a group. */
export async function setUserGroup(userId: string, _: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const admin = await requireUser("admin");
    const { groupId } = z.object({ groupId: optId }).parse(fields(form));
    if (groupId) {
      const [g] = await withOrg(admin.orgId, (tx) => tx.select({ id: securityGroups.id }).from(securityGroups).where(eq(securityGroups.id, groupId)));
      if (!g) throw new CustodyError("That group doesn't exist.");
    }
    const [u] = await db
      .update(users)
      .set({ groupId })
      .where(and(eq(users.id, userId), eq(users.orgId, admin.orgId)))
      .returning({ id: users.id });
    if (!u) throw new CustodyError("User not found.");
    revalidatePath("/team");
    return { ok: "Group updated." };
  });
}
