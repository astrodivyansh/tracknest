import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assets, checkouts, customFields, organizations, persons, users } from "@/db/schema";
import { runAlerts } from "./alerts";
import { checkOut, nextTag, type Actor } from "./custody";
import type { Mail } from "./mail";
import { scheduleMaintenance } from "./maintenance";

// 11:30 in Kolkata. Fixed in the future so check-out's "due date not in the past" rule allows it.
const NOW = new Date("2030-01-15T06:00:00Z");
const stamp = Date.now();
const owner = `owner-${stamp}@test.local`;
const viewer = `viewer-${stamp}@test.local`;
const holder = `holder-${stamp}@test.local`;
const ours = (m: Mail) => [owner, viewer, holder].includes(m.to);

let actor: Actor;

async function collect(now = NOW, fail?: string) {
  const mails: Mail[] = [];
  await runAlerts({
    now,
    origin: "https://app.test",
    orgId: actor.orgId,
    send: async (m) => {
      if (m.to === fail) throw new Error("smtp down");
      mails.push(m);
    },
  });
  return mails.filter(ours);
}

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: "Alert School", timezone: "Asia/Kolkata" }).returning();
  const [u] = await db.insert(users).values({ orgId: org.id, name: "Owner", email: owner, passwordHash: "x", role: "owner" }).returning();
  await db.insert(users).values({ orgId: org.id, name: "Viewer", email: viewer, passwordHash: "x", role: "viewer" });
  actor = { id: u.id, name: u.name, orgId: org.id };

  await withOrg(org.id, async (tx) => {
    const [p] = await tx.insert(persons).values({ orgId: org.id, name: "Meera", email: holder }).returning();
    const asset = async (name: string) =>
      (await tx.insert(assets).values({ orgId: org.id, tag: await nextTag(tx, org.id), name }).returning())[0];

    const late = await asset("Laptop");
    const co = await checkOut(tx, actor, {
      assetId: late.id, holderType: "person", holderId: p.id, dueAt: new Date("2030-01-20T18:29:59Z"),
    });
    await tx.update(checkouts).set({ dueAt: new Date("2030-01-10T18:29:59Z") }).where(eq(checkouts.id, co.id)); // now 5 days late

    const today = await asset("Camera");
    await checkOut(tx, actor, { assetId: today.id, holderType: "person", holderId: p.id, dueAt: new Date("2030-01-15T18:29:59Z") });

    const printer = await asset("Printer");
    await scheduleMaintenance(tx, actor, { assetId: printer.id, title: "Service", kind: "preventive", dueDate: "2030-01-18" });

    const [warranty] = await tx.insert(customFields).values({ orgId: org.id, label: "Warranty expiry", type: "date", remindDays: 30 }).returning();
    await tx.update(assets).set({ custom: { [warranty.id]: "2030-02-01" } }).where(eq(assets.id, printer.id));
  });
});

describe("daily alerts", () => {
  it("waits until 8 AM local time", async () => {
    expect(await collect(new Date("2030-01-15T01:00:00Z"))).toEqual([]); // 06:30 IST
  });

  it("emails the holder and a summary to managers, once per day", async () => {
    const mails = await collect();
    expect(mails.map((m) => [m.to, m.subject]).sort()).toEqual([
      [holder, "Overdue: please return TN-000001"],
      [holder, "Reminder: please return TN-000002 today"],
      [owner, "Alert School: 1 overdue, 1 due today, 1 maintenance"],
    ]);
    const digest = mails.find((m) => m.to === owner)!.text;
    expect(digest).toContain("TN-000001 Laptop — Meera, due 10 Jan 2030");
    expect(digest).toContain("TN-000003 Printer — Service, due 18 Jan 2030");
    expect(digest).toContain("https://app.test/assets/");
    expect(digest).toContain("Dates coming up (1)\n• TN-000003 Printer — Warranty expiry: 1 Feb 2030");

    expect(await collect()).toEqual([]); // the hourly re-run sends nothing new
    // Next day: a new digest, and the camera is now overdue. The laptop's weekly reminder isn't due yet.
    expect((await collect(new Date("2030-01-16T06:00:00Z"))).map((m) => m.subject).sort()).toEqual([
      "Alert School: 2 overdue, 0 due today, 1 maintenance",
      "Overdue: please return TN-000002",
    ]);
  });

  it("retries an email that failed to send", async () => {
    const day = new Date("2030-01-17T06:00:00Z");
    expect((await collect(day, owner)).map((m) => m.to)).not.toContain(owner);
    expect((await collect(day)).map((m) => m.to)).toEqual([owner]);
  });
});
