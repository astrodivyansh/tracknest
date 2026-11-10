import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { subscriptionPayments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getObject } from "@/lib/storage";

/** Serves a recharge invoice to signed-in members of its org only (RLS hides other orgs' rows). */
export async function GET(_: Request, { params }: RouteContext<"/subscriptions/invoice/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const [p] = await withOrg(user.orgId, (tx) => tx.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, id)));
  if (!p?.invoiceKey) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": p.invoiceType!,
    "Content-Length": String(p.invoiceSize),
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(p.invoiceName!)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };
  // Same rule as asset files: images can never run script.
  if (p.invoiceType!.startsWith("image/")) headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
  return new Response(new Uint8Array(await getObject(p.invoiceKey)), { headers });
}
