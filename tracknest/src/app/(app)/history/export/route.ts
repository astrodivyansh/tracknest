import { withOrg } from "@/db";
import { requireUser } from "@/lib/auth";
import { describeEvent, EVENT_LABEL } from "@/lib/format";
import { listEvents, parseFilters } from "@/lib/history";

// shortcut: builds the whole CSV in memory, capped at 100k rows; stream it if orgs outgrow that.
const MAX_ROWS = 100_000;

// Quote every cell; prefix formula-like values so Excel won't execute them.
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export async function GET(request: Request) {
  const user = await requireUser();
  const f = parseFilters(Object.fromEntries(new URL(request.url).searchParams));
  const rows = await withOrg(user.orgId, (tx) => listEvents(tx, f, user.timezone, MAX_ROWS));

  const header = ["occurred_at_utc", "asset_tag", "asset_name", "action", "holder", "details", "performed_by", "source"];
  const lines = rows.map((e) =>
    [
      e.occurredAt.toISOString(),
      e.assetTag,
      e.assetName,
      EVENT_LABEL[e.type],
      (e.payload as { holderName?: string }).holderName ?? "",
      describeEvent(e, user.timezone),
      e.actorName,
      e.source,
    ]
      .map(cell)
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\r\n");
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="custody-history-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
