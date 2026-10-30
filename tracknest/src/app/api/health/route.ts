import { sql } from "drizzle-orm";
import { db } from "@/db";

/** For uptime monitors and the Docker healthcheck: 200 when the app can reach the database. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
