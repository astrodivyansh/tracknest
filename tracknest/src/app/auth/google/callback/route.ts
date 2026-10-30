import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { redirect } from "next/navigation";
import { appOrigin, clearLoginFailures, startSession } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { exchangeCode, googleAccount, googleEnabled, OAUTH_COOKIE } from "@/lib/google";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const saved = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/auth/google" });
  const { state, verifier, invite } = (saved ? JSON.parse(saved) : {}) as { state?: string; verifier?: string; invite?: string | null };
  const back = (message: string) =>
    redirect(invite ? `/invite/${encodeURIComponent(invite)}?error=${encodeURIComponent(message)}` : `/login?error=${encodeURIComponent(message)}`);

  if (!googleEnabled()) redirect("/login");
  if (params.get("error")) back("Google sign-in was cancelled.");
  // The state must be the one we set, or someone is trying to log this browser into their account.
  if (!state || !verifier || params.get("state") !== state || !params.get("code")) back("That sign-in link expired. Try again.");

  let userId: string;
  let email: string;
  try {
    const claims = await exchangeCode(params.get("code")!, verifier!, await appOrigin());
    email = claims.email;
    userId = await googleAccount(claims, invite ?? null);
  } catch (e) {
    if (!(e instanceof CustodyError)) console.error("google sign-in failed", e);
    return back(e instanceof CustodyError ? e.message : "Google sign-in failed. Try again.");
  }
  // Google proves the email, not the authenticator: two-step users sign in with their password and code.
  const [u] = await db.select({ twoStep: users.totpEnabled }).from(users).where(eq(users.id, userId));
  if (u?.twoStep) back("Two-step sign-in is on for this account. Sign in with your password and authenticator code.");
  await clearLoginFailures(email);
  await startSession(userId);
  redirect("/dashboard");
}
