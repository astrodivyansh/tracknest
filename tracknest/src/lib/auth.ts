import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, organizations, ROLES, type Role } from "@/db/schema";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const COOKIE = "tn_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [, saltHex, hashHex] = stored.split("$");
  const hash = await scryptAsync(password, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(COOKIE);
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  orgId: string;
  orgName: string;
  timezone: string;
  currency: string;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      orgId: users.orgId,
      orgName: organizations.name,
      timezone: organizations.timezone,
      currency: organizations.currency,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
});

/** Call at the top of every page and server action that touches org data. */
export async function requireUser(minRole: Role = "viewer"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (ROLES.indexOf(user.role) < ROLES.indexOf(minRole)) throw new Error("You don't have permission to do this.");
  return user;
}

export const canEdit = (u: CurrentUser) => ROLES.indexOf(u.role) >= ROLES.indexOf("manager");
