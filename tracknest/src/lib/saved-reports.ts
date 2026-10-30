import { withOrg } from "@/db";
import { savedReports } from "@/db/schema";
import { deliver } from "./alerts";
import { toCsv } from "./csv";
import type { Mail } from "./mail";
import { csvRows, REPORTS, runReport } from "./reports";

const MAX_ROWS = 50_000; // keeps attachments to a few MB

/** Whether a schedule is due on `today` (YYYY-MM-DD, the org's calendar). */
export function isDue(schedule: string, today: string) {
  if (schedule === "daily") return true;
  if (schedule === "weekly") return new Date(`${today}T00:00:00Z`).getUTCDay() === 1; // Monday
  if (schedule === "monthly") return today.endsWith("-01");
  return false;
}

/** Emails each scheduled report due today as a CSV, once per recipient per day (claimed in alert_log). */
export async function sendScheduledReports(
  org: { id: string; name: string; tz: string; fyStartMonth?: number },
  today: string,
  send: (m: Mail) => Promise<void>,
  origin: string,
) {
  const due = (await withOrg(org.id, (tx) => tx.select().from(savedReports))).filter((s) => isDue(s.schedule, today));
  let sent = 0;
  for (const s of due) {
    const report = REPORTS.find((r) => r.slug === s.slug);
    if (!report) continue;
    const params = new URLSearchParams(s.params);
    const sp = { ...Object.fromEntries(params), col: params.getAll("col") };
    const r = await withOrg(org.id, (tx) => runReport(tx, report, sp, org.tz, MAX_ROWS, org.fyStartMonth));
    const csv = toCsv(r.columns.map((c) => c.label), csvRows(r.rows, org.tz));
    for (const to of s.recipients) {
      const res = await deliver(
        org.id,
        {
          key: `report:${s.id}:${today}:${to.toLowerCase()}`,
          mail: {
            to,
            subject: `${org.name}: ${s.name} (${r.rows.length} rows)`,
            text: `Hi,\n\nAttached is the ${s.schedule} report “${s.name}” from ${org.name}.\nOpen it online: ${origin}/reports/${s.slug}${s.params ? `?${s.params}` : ""}\n\n— TrackNest`,
            attachments: [{ filename: r.filename, content: csv }],
          },
        },
        send,
      );
      if (res === "sent") sent++;
    }
  }
  return sent;
}
