import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq, and, count, gt, lt, ne, sql } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { loginFailures, organizations, ROLES, securityGroups, sessions, users, type Role } from "@/db/schema";
import { setDateFormat } from "./format";
import { verifyCode } from "./totp";

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

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---- Sign-in rate limiting ----
const WINDOW_MS = 15 * 60_000;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 30;

/** Client IP as reported by the reverse proxy (Caddy sets X-Forwarded-For); only trustworthy behind it. */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

export async function isLoginBlocked(email: string, ip: string) {
  const since = new Date(Date.now() - WINDOW_MS);
  const [byEmail] = await db
    .select({ n: count() })
    .from(loginFailures)
    .where(and(eq(loginFailures.email, email), gt(loginFailures.at, since)));
  const [byIp] = await db
    .select({ n: count() })
    .from(loginFailures)
    .where(and(eq(loginFailures.ip, ip), gt(loginFailures.at, since)));
  return byEmail.n >= MAX_PER_EMAIL || byIp.n >= MAX_PER_IP;
}

export async function recordLoginFailure(email: string, ip: string) {
  await db.insert(loginFailures).values({ email, ip });
  await db.delete(loginFailures).where(lt(loginFailures.at, new Date(Date.now() - WINDOW_MS)));
}

// Only the email's counter: clearing the IP's would let one valid account reset an attacker's IP budget.
export async function clearLoginFailures(email: string) {
  await db.delete(loginFailures).where(eq(loginFailures.email, email));
}

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

/** Signs the user out everywhere except this browser. */
export async function endOtherSessions(userId: string) {
  const token = (await cookies()).get(COOKIE)?.value ?? "";
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, sha256(token))));
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
  fyStartMonth: number;
  logoVersion: string | null; // changes with each upload, for the /logo URL
  disabled: string[]; // features the org turned off
  perms: string[] | null; // the user's security group; null = no group
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
      dateFormat: organizations.dateFormat,
      fyStartMonth: organizations.fyStartMonth,
      logoVersion: sql<string | null>`right(${organizations.logoKey}, 8)`,
      disabled: organizations.disabledFeatures,
      groupId: users.groupId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  const { dateFormat, groupId, ...user } = row;
  setDateFormat(dateFormat);
  // Security groups are tenant rows (RLS), so read inside the org. A missing group grants nothing (fail closed).
  const perms = groupId
    ? ((await withOrg(user.orgId, (tx) => tx.select({ p: securityGroups.permissions }).from(securityGroups).where(eq(securityGroups.id, groupId))))[0]?.p ?? [])
    : null;
  return { ...user, perms };
});

/** Call at the top of every page and server action that touches org data. */
export async function requireUser(minRole: Role = "viewer"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (ROLES.indexOf(user.role) < ROLES.indexOf(minRole)) throw new Error("You don't have permission to do this.");
  return user;
}

export const canEdit = (u: CurrentUser) => ROLES.indexOf(u.role) >= ROLES.indexOf("manager");
export const isAdmin = (u: CurrentUser) => ROLES.indexOf(u.role) >= ROLES.indexOf("admin");

/** Public base URL for links we hand out (QR codes, invites). Set APP_URL in production. */
export async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/**
 * Second sign-in step for users with two-step sign-in on: the code must match and be newer than the
 * last one used. Claims the step atomically, so two sign-ins can't share a code.
 */
export async function passesTwoStep(user: { id: string; totpEnabled: boolean; totpSecret: string | null; totpLastStep: number | null }, code: string) {
  if (!user.totpEnabled) return true;
  const step = user.totpSecret ? verifyCode(user.totpSecret, code, Date.now(), user.totpLastStep) : null;
  if (step === null) return false;
  const [claimed] = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, user.id), sql`coalesce(${users.totpLastStep}, -1) < ${step}`))
    .returning({ id: users.id });
  return !!claimed;
}
