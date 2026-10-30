import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys, organizations } from "@/db/schema";
import { sha256 } from "./auth";
import { CustodyError, type Actor } from "./custody";

/** An error with an HTTP status and a stable code, as in openapi.yaml. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found.`);

export type ApiCtx = { actor: Actor; orgId: string; tz: string; origin: string };

const RATE_LIMIT = 120; // requests per key per minute
// shortcut: in-memory counter, correct for the single app container in docker-compose; move to Postgres/Redis if you run several.
const hits = new Map<string, { windowStart: number; count: number }>();

function rateLimit(keyId: string) {
  const now = Date.now();
  const h = hits.get(keyId);
  if (!h || now - h.windowStart >= 60_000) return void hits.set(keyId, { windowStart: now, count: 1 });
  if (++h.count > RATE_LIMIT) throw new ApiError(429, "rate_limited", `More than ${RATE_LIMIT} requests a minute. Slow down.`);
}

async function authenticate(req: Request, needs: "read" | "write"): Promise<ApiCtx> {
  const m = req.headers.get("authorization")?.match(/^Bearer (tn_[A-Za-z0-9_-]{20,})$/);
  if (!m) throw new ApiError(401, "unauthorized", "Send an API key as: Authorization: Bearer tn_…");
  const [key] = await db
    .select({ id: apiKeys.id, name: apiKeys.name, orgId: apiKeys.orgId, scope: apiKeys.scope, tz: organizations.timezone })
    .from(apiKeys)
    .innerJoin(organizations, eq(organizations.id, apiKeys.orgId))
    .where(and(eq(apiKeys.keyHash, sha256(m[1])), isNull(apiKeys.revokedAt)));
  if (!key) throw new ApiError(401, "unauthorized", "This API key is invalid or has been revoked.");
  if (needs === "write" && key.scope !== "write") throw new ApiError(403, "forbidden", "This is a read-only key.");
  rateLimit(key.id);
  // At most one write a minute per key, so busy integrations don't turn every read into a write.
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.id, key.id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, sql`now() - interval '1 minute'`))));
  return {
    actor: { id: key.id, name: `API key: ${key.name}`, orgId: key.orgId },
    orgId: key.orgId,
    tz: key.tz,
    origin: process.env.APP_URL ?? new URL(req.url).origin,
  };
}

function toResponse(e: unknown) {
  const err = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });
  if (e instanceof ApiError) return err(e.status, e.code, e.message);
  if (e instanceof z.ZodError) {
    const i = e.issues[0];
    return err(400, "bad_request", i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message);
  }
  if (e instanceof CustodyError) return err(409, "conflict", e.message);
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") return err(409, "conflict", "That value is already in use (for example the asset tag).");
  if (code === "23P01") return err(409, "conflict", "Those dates overlap another reservation.");
  console.error("api error", e);
  return err(500, "internal", "Something went wrong.");
}

/** Wraps a route handler: authenticates the key, checks scope, and turns errors into JSON. */
export function api<P = Record<string, never>>(
  needs: "read" | "write",
  fn: (ctx: ApiCtx, req: Request, params: P) => Promise<unknown>,
) {
  return async (req: Request, route?: { params: Promise<P> }) => {
    try {
      const ctx = await authenticate(req, needs);
      const out = await fn(ctx, req, (await route?.params) as P);
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      return toResponse(e);
    }
  };
}

/** Parses the JSON body; `optional` lets an empty body through as {}. */
export async function readJson(req: Request, { optional = false } = {}) {
  const text = await req.text();
  if (!text.trim() && optional) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "bad_request", "The request body must be JSON.");
  }
}

/** ?page & ?limit, clamped to the documented ranges. */
export function paging(req: Request) {
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  const limit = Math.min(200, Math.max(1, Math.floor(Number(sp.get("limit"))) || 50));
  return { page, limit, offset: (page - 1) * limit };
}
