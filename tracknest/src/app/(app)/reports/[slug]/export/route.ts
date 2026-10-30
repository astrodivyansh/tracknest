import { withOrg } from "@/db";
import { requireUser } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { csvRows, REPORTS, runReport } from "@/lib/reports";

// shortcut: whole CSV in memory, capped at 100k rows; stream it if orgs outgrow that.
const MAX_ROWS = 100_000;

export async function GET(request: Request, { params }: RouteContext<"/reports/[slug]/export">) {
  const user = await requireUser();
  const { slug } = await params;
  const report = REPORTS.find((r) => r.slug === slug);
  if (!report) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const sp = { ...Object.fromEntries(url.searchParams), col: url.searchParams.getAll("col") };
  const r = await withOrg(user.orgId, (tx) => runReport(tx, report, sp, user.timezone, MAX_ROWS, user.fyStartMonth));
  return csvResponse(r.filename, r.columns.map((c) => c.label), csvRows(r.rows, user.timezone));
}
