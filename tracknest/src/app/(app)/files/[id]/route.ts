import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assetFiles } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getObject } from "@/lib/storage";

/** Serves an asset file to signed-in members of its org only (RLS hides other orgs' rows). */
export async function GET(request: Request, { params }: RouteContext<"/files/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const [file] = await withOrg(user.orgId, (tx) => tx.select().from(assetFiles).where(eq(assetFiles.id, id)));
  if (!file) return new Response("Not found", { status: 404 });

  const download = new URL(request.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Content-Length": String(file.size),
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };
  // Images can never run script. (PDFs skip the sandbox: Chrome won't show sandboxed PDFs inline.)
  if (file.kind === "photo") headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
  return new Response(new Uint8Array(await getObject(file.storageKey)), { headers });
}
