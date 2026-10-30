import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { audits } from "@/db/schema";
import { auditRows, GROUP_LABEL } from "@/lib/audit-view";
import { requireUser } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { isoDateIn } from "@/lib/format";

export async function GET(_: Request, { params }: RouteContext<"/audits/[id]/export">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const data = await withOrg(user.orgId, async (tx) => {
    const [audit] = await tx.select().from(audits).where(eq(audits.id, id));
    return audit && { audit, rows: await auditRows(tx, id) };
  });
  if (!data) return new Response("Not found", { status: 404 });
  return csvResponse(
    `audit-${data.audit.name.replace(/[^\w-]+/g, "-")}-${isoDateIn(data.audit.createdAt, user.timezone)}.csv`,
    ["Tag", "Name", "Result", "Should be in", "Scanned in", "Scanned at", "Scanned by"],
    data.rows.map((r) => [
      r.tag,
      r.name,
      GROUP_LABEL[r.group],
      r.expectedLocation,
      r.result === "found" ? (r.foundLocation ?? "Unknown") : "",
      r.foundAt ? r.foundAt.toISOString() : "",
      r.foundBy,
    ]),
  );
}
