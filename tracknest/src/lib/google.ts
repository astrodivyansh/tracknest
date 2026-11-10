import { createHash, randomBytes } from "node:crypto";
import { and, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "./auth";
import { CustodyError } from "./custody";
import { redeemInvite } from "./invites";

// "Sign in with Google": OAuth 2.0 authorization-code flow with PKCE, no SDK.
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** Holds state, PKCE verifier and invite token between the redirect to Google and the callback. */
export const OAUTH_COOKIE = "tn_google";

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const callbackUrl = (origin: string) => `${origin}/auth/google/callback`;

const b64url = (b: Buffer) => b.toString("base64url");

export function startParams(origin: string) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, verifier };
}

export type GoogleClaims = { email: string; name: string };

/**
 * Checks the ID token's claims. The token came straight from Google's token endpoint over TLS in
 * exchange for our client secret, which OpenID Connect accepts in place of a signature check (Core §3.1.3.7).
 */
export function checkClaims(idToken: string, clientId: string, now = Date.now()): GoogleClaims {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
  } catch {
    throw new CustodyError("Google sent an unreadable sign-in token.");
  }
  if (!ISSUERS.includes(p.iss as string) || p.aud !== clientId) throw new CustodyError("That Google sign-in wasn't meant for TrackNest.");
  if (typeof p.exp !== "number" || p.exp * 1000 < now) throw new CustodyError("That Google sign-in has expired. Try again.");
  if (p.email_verified !== true || typeof p.email !== "string") throw new CustodyError("Your Google account's email isn't verified.");
  const email = p.email.toLowerCase();
  return { email, name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : email.split("@")[0] };
}

export async function exchangeCode(code: string, verifier: string, origin: string): Promise<GoogleClaims> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackUrl(origin),
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`Google token exchange failed: ${res.status} ${body.error ?? ""}`);
  return checkClaims(body.id_token, process.env.GOOGLE_CLIENT_ID!);
}

/** The TrackNest account for this Google identity: an existing user, or a new one from an invite. */
export async function googleAccount(claims: GoogleClaims, inviteToken: string | null) {
  if (inviteToken) {
    // No password yet; they can set one later with "Forgot password?".
    const unusable = await hashPassword(b64url(randomBytes(32)));
    return redeemInvite(inviteToken, { name: claims.name, passwordHash: unusable, email: claims.email });
  }
  const [user] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${claims.email}`, isNull(users.deletedAt)));
  if (!user) throw new CustodyError(`There's no TrackNest account for ${claims.email}. Ask your admin for an invite.`);
  return user.id;
}
