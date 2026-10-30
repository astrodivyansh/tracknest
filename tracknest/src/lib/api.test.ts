import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db, withOrg } from "@/db";
import { apiKeys, customFields, organizations, persons } from "@/db/schema";
import * as assetsRoute from "@/app/api/v1/assets/route";
import * as assetRoute from "@/app/api/v1/assets/[tag]/route";
import * as historyRoute from "@/app/api/v1/assets/[tag]/history/route";
import * as checkoutRoute from "@/app/api/v1/assets/[tag]/checkout/route";
import * as checkinRoute from "@/app/api/v1/assets/[tag]/checkin/route";
import * as peopleRoute from "@/app/api/v1/people/route";
import * as lookupsRoute from "@/app/api/v1/lookups/route";
import * as eventsRoute from "@/app/api/v1/events/route";
import { sha256 } from "./auth";

const BASE = "http://test.local/api/v1";
let readKey: string;
let writeKey: string;
let otherOrgKey: string;
let personId: string;

async function newKey(orgId: string, scope: "read" | "write") {
  const key = `tn_${randomBytes(24).toString("base64url")}`;
  await db.insert(apiKeys).values({ orgId, name: `${scope} test`, keyHash: sha256(key), prefix: key.slice(0, 10), scope, createdBy: "test" });
  return key;
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(handler: Handler, path: string, key: string | null, init: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const req = new Request(BASE + path, {
    method: init.method ?? "GET",
    headers: key ? { authorization: `Bearer ${key}` } : {},
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await handler(req, { params: Promise.resolve(init.params ?? {}) });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `API ${Date.now()}`, timezone: "Asia/Kolkata" }).returning();
  const [other] = await db.insert(organizations).values({ name: `API other ${Date.now()}` }).returning();
  readKey = await newKey(org.id, "read");
  writeKey = await newKey(org.id, "write");
  otherOrgKey = await newKey(other.id, "write");
  await withOrg(org.id, async (tx) => {
    personId = (await tx.insert(persons).values({ orgId: org.id, name: "Kavya", email: "kavya@x.test" }).returning())[0].id;
    await tx.insert(customFields).values({ orgId: org.id, label: "Warranty expiry", type: "date" });
  });
});

describe("API v1", () => {
  it("rejects missing, wrong and under-scoped keys with the documented error shape", async () => {
    expect(await call(assetsRoute.GET as Handler, "/assets", null)).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } });
    expect((await call(assetsRoute.GET as Handler, "/assets", "tn_" + "x".repeat(30))).status).toBe(401);
    expect(await call(assetsRoute.POST as Handler, "/assets", readKey, { method: "POST", body: { name: "X" } })).toMatchObject({
      status: 403,
      body: { error: { code: "forbidden" } },
    });
  });

  it("creates an asset, then checks it out and in, recording history as the API key", async () => {
    const created = await call(assetsRoute.POST as Handler, "/assets", writeKey, {
      method: "POST",
      body: { name: "ThinkPad X1", cost: "120000.00", customFields: { "warranty expiry": "31/12/2027" } },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "ThinkPad X1", status: "available", cost: "120000.00", holder: null, customFields: { "Warranty expiry": "2027-12-31" } });
    const tag = created.body.tag as string;

    const out = await call(checkoutRoute.POST as Handler, `/assets/${tag}/checkout`, writeKey, {
      method: "POST",
      params: { tag },
      body: { holder: { type: "person", id: personId }, dueDate: "2099-01-31" },
    });
    expect(out.body).toMatchObject({ status: "checked_out", holder: { type: "person", name: "Kavya" } });

    const again = await call(checkoutRoute.POST as Handler, `/assets/${tag}/checkout`, writeKey, {
      method: "POST",
      params: { tag },
      body: { holder: { type: "person", id: personId } },
    });
    expect(again).toMatchObject({ status: 409, body: { error: { code: "conflict" } } });

    const back = await call(checkinRoute.POST as Handler, `/assets/${tag}/checkin`, writeKey, { method: "POST", params: { tag } }); // no body
    expect(back.body).toMatchObject({ status: "available", holder: null });

    const history = await call(historyRoute.GET as Handler, `/assets/${tag}/history`, readKey, { params: { tag } });
    expect(history.body.data.map((e: { type: string }) => e.type)).toEqual(["checked_in", "checked_out", "created"]);
    expect(history.body.data.every((e: { source: string; actor: string }) => e.source === "api" && e.actor === "API key: write test")).toBe(true);
    expect(history.body.data[1].description).toMatch(/Checked out to Kavya · due 31 Jan 2099/);
  });

  it("validates input and reports unknown assets", async () => {
    expect((await call(assetsRoute.POST as Handler, "/assets", writeKey, { method: "POST", body: { cost: "12" } })).status).toBe(400);
    expect(
      (await call(assetsRoute.POST as Handler, "/assets", writeKey, { method: "POST", body: { name: "A", customFields: { Colour: "red" } } })).body.error
        .message,
    ).toMatch(/no field called “Colour”/);
    expect((await call(assetRoute.GET as Handler, "/assets/NOPE-1", readKey, { params: { tag: "NOPE-1" } })).status).toBe(404);
  });

  it("lists and searches assets, people and lookups", async () => {
    const list = await call(assetsRoute.GET as Handler, "/assets?q=thinkpad&limit=5", readKey);
    expect(list.body).toMatchObject({ page: 1, limit: 5, total: 1 });
    const person = await call(peopleRoute.POST as Handler, "/people", writeKey, { method: "POST", body: { name: "Arjun", employeeId: "E9" } });
    expect(person).toMatchObject({ status: 201, body: { name: "Arjun", employeeId: "E9", email: null } });
    expect((await call(peopleRoute.GET as Handler, "/people", readKey)).body.total).toBe(2);
    expect((await call(lookupsRoute.GET as Handler, "/lookups", readKey)).body.customFields).toEqual([
      { label: "Warranty expiry", type: "date", options: [], required: false, categoryId: null },
    ]);
  });

  it("keeps organizations apart", async () => {
    const list = await call(assetsRoute.GET as Handler, "/assets", otherOrgKey);
    expect(list.body.total).toBe(0);
    const tag = (await call(assetsRoute.GET as Handler, "/assets", readKey)).body.data[0].tag;
    expect((await call(assetRoute.GET as Handler, `/assets/${tag}`, otherOrgKey, { params: { tag } })).status).toBe(404);
  });

  it("the events feed pages forward without repeating or skipping entries", async () => {
    const all = (await call(eventsRoute.GET as Handler, "/events?limit=200", readKey)).body.data;
    const seen: string[] = [];
    let since = "";
    for (let i = 0; i < 20; i++) {
      const page = await call(eventsRoute.GET as Handler, `/events?limit=1${since ? `&since=${encodeURIComponent(since)}` : ""}`, readKey);
      if (page.body.data.length === 0) break;
      seen.push(...page.body.data.map((e: { id: string }) => e.id));
      since = page.body.nextSince;
    }
    expect(seen).toEqual(all.map((e: { id: string }) => e.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("rate-limits a key after 120 requests a minute", async () => {
    const key = await newKey((await db.select().from(organizations).limit(1))[0].id, "read");
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await call(lookupsRoute.GET as Handler, "/lookups", key)).status;
    expect(last).toBe(429);
  });
});
