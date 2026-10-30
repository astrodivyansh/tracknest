import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appOrigin } from "@/lib/auth";
import { googleEnabled, OAUTH_COOKIE, startParams } from "@/lib/google";

/** Sends the browser to Google. ?invite=<token> signs up through that invite instead of signing in. */
export async function GET(req: Request) {
  if (!googleEnabled()) redirect("/login");
  const invite = new URL(req.url).searchParams.get("invite");
  const { url, state, verifier } = startParams(await appOrigin());
  (await cookies()).set(OAUTH_COOKIE, JSON.stringify({ state, verifier, invite }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // must survive the top-level redirect back from Google
    path: "/auth/google",
    maxAge: 600,
  });
  redirect(url);
}
