import { timingSafeEqual } from "node:crypto";
import { runAlerts } from "@/lib/alerts";

/** Called hourly by cron: curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/alerts */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await runAlerts());
}
