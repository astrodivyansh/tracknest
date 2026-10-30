import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { detectType } from "@/lib/files";
import { getObject } from "@/lib/storage";

/** The signed-in user's organization logo. */
export async function GET() {
  const user = await requireUser();
  const [org] = await db.select({ key: organizations.logoKey }).from(organizations).where(eq(organizations.id, user.orgId));
  if (!org?.key) return new Response("Not found", { status: 404 });
  const bytes = new Uint8Array(await getObject(org.key));
  return new Response(bytes, {
    headers: {
      "Content-Type": detectType(bytes)?.contentType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
