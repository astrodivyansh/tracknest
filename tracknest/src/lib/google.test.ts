import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invites, organizations, users } from "@/db/schema";
import { sha256 } from "./auth";
import { checkClaims, exchangeCode, googleAccount, startParams } from "./google";

const CLIENT = "test-client.apps.googleusercontent.com";
const token = (claims: Record<string, unknown>) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
const good = { iss: "https://accounts.google.com", aud: CLIENT, exp: Date.now() / 1000 + 300, email: "Neha@Example.com", email_verified: true, name: "Neha" };

let orgId: string;
const stamp = Date.now();

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = CLIENT;
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  orgId = (await db.insert(organizations).values({ name: `Google ${stamp}` }).returning())[0].id;
  await db.insert(users).values({ orgId, name: "Existing", email: `Existing-${stamp}@Example.com`, passwordHash: "x", role: "manager" });
});
afterEach(() => vi.unstubAllGlobals());

async function invite(email: string) {
  const t = randomBytes(16).toString("hex");
  await db.insert(invites).values({ id: sha256(t), orgId, email, role: "viewer", invitedBy: "Admin", expiresAt: new Date(Date.now() + 864e5) });
  return t;
}

describe("Google sign-in", () => {
  it("accepts only verified, unexpired tokens issued for this app", () => {
    expect(checkClaims(token(good), CLIENT)).toEqual({ email: "neha@example.com", name: "Neha" });
    expect(() => checkClaims(token({ ...good, aud: "someone-else" }), CLIENT)).toThrow(/wasn't meant for TrackNest/);
    expect(() => checkClaims(token({ ...good, iss: "https://evil.test" }), CLIENT)).toThrow(/wasn't meant/);
    expect(() => checkClaims(token({ ...good, exp: Date.now() / 1000 - 1 }), CLIENT)).toThrow(/expired/);
    expect(() => checkClaims(token({ ...good, email_verified: false }), CLIENT)).toThrow(/isn't verified/);
    expect(() => checkClaims("garbage", CLIENT)).toThrow(/unreadable/);
    expect(checkClaims(token({ ...good, name: undefined }), CLIENT).name).toBe("neha");
  });

  it("builds a PKCE request whose challenge matches the verifier", () => {
    const { url, state, verifier } = startParams("https://app.test");
    const p = new URL(url).searchParams;
    expect(p.get("client_id")).toBe(CLIENT);
    expect(p.get("redirect_uri")).toBe("https://app.test/auth/google/callback");
    expect(p.get("state")).toBe(state);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("exchanges the code with the verifier and checks the returned token", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id_token: token(good) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await exchangeCode("the-code", "the-verifier", "https://app.test")).toMatchObject({ email: "neha@example.com" });
    const sent = new URLSearchParams(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect([sent.get("code"), sent.get("code_verifier"), sent.get("grant_type")]).toEqual(["the-code", "the-verifier", "authorization_code"]);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })));
    await expect(exchangeCode("x", "y", "https://app.test")).rejects.toThrow(/invalid_grant/);
  });

  it("signs in existing users by email, case-insensitively, and refuses unknown emails", async () => {
    const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${`existing-${stamp}@example.com`}`);
    expect(await googleAccount({ email: `existing-${stamp}@example.com`, name: "X" }, null)).toBe(u.id);
    await expect(googleAccount({ email: `nobody-${stamp}@example.com`, name: "X" }, null)).rejects.toThrow(/no TrackNest account/);
  });

  it("joins through an invite only with the invited email, once", async () => {
    const t = await invite(`invitee-${stamp}@example.com`);
    await expect(googleAccount({ email: `other-${stamp}@example.com`, name: "Other" }, t)).rejects.toThrow(/This invite is for/);
    const id = await googleAccount({ email: `invitee-${stamp}@example.com`, name: "Invitee" }, t);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(u).toMatchObject({ orgId, role: "viewer", name: "Invitee" });
    expect(u.passwordHash.startsWith("scrypt$")).toBe(true); // unusable random password until they set one
    await expect(googleAccount({ email: `invitee-${stamp}@example.com`, name: "Invitee" }, t)).rejects.toThrow(/already used/);
  });
});
