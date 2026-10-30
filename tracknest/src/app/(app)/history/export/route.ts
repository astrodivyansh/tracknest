import { withOrg } from "@/db";
import { requireUser } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { describeEvent, EVENT_LABEL } from "@/lib/format";
import { listEvents, parseFilters } from "@/lib/history";

// shortcut: builds the whole CSV in memory, capped at 100k rows; stream it if orgs outgrow that.
const MAX_ROWS = 100_000;

export async function GET(request: Request) {
  const user = await requireUser();
  const f = parseFilters(Object.fromEntries(new URL(request.url).searchParams));
  const rows = await withOrg(user.orgId, (tx) => listEvents(tx, f, user.timezone, MAX_ROWS));
  return csvResponse(
    `custody-history-${new Date().toISOString().slice(0, 10)}.csv`,
    ["occurred_at_utc", "asset_tag", "asset_name", "action", "holder", "details", "performed_by", "source"],
    rows.map((e) => [
      e.occurredAt.toISOString(),
      e.assetTag,
      e.assetName,
      EVENT_LABEL[e.type],
      (e.payload as { holderName?: string }).holderName ?? "",
      describeEvent(e, user.timezone),
      e.actorName,
      e.source,
    ]),
  );
}
