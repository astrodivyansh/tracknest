import { withOrg } from "@/db";
import { requireUser } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { EXPORTS } from "@/lib/data-export";
import { isoDateIn } from "@/lib/format";

export async function GET(_: Request, { params }: RouteContext<"/export/[table]">) {
  const user = await requireUser();
  const { table } = await params;
  const t = Object.hasOwn(EXPORTS, table) ? EXPORTS[table] : null;
  if (!t) return new Response("Not found", { status: 404 });
  const rows = await withOrg(user.orgId, t.rows);
  return csvResponse(`${table}-${isoDateIn(new Date(), user.timezone)}.csv`, t.header, rows);
}
