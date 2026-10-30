import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assetEvents, assets, maintenance, organizations, persons, users } from "@/db/schema";
import { changeStatus, checkOut, nextTag, type Actor } from "./custody";
import { addMonths, cancelMaintenance, completeMaintenance, scheduleMaintenance, startMaintenance } from "./maintenance";

let actor: Actor;
let personId: string;
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);

const newAsset = () =>
  run(async (tx) => (await tx.insert(assets).values({ orgId: actor.orgId, tag: await nextTag(tx, actor.orgId), name: "Printer" }).returning())[0]);
const statusOf = async (id: string) => (await run((tx) => tx.select().from(assets).where(eq(assets.id, id))))[0].status;

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Maint ${Date.now()}` }).returning();
  const [u] = await db
    .insert(users)
    .values({ orgId: org.id, name: "Admin", email: `maint-${Date.now()}@test.local`, passwordHash: "x", role: "owner" })
    .returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
  personId = (await run((tx) => tx.insert(persons).values({ orgId: org.id, name: "Asha" }).returning()))[0].id;
});

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("maintenance jobs", () => {
  it("start → complete moves the asset in and out of maintenance and schedules the next repeat", async () => {
    const asset = await newAsset();
    const job = await run((tx) =>
      scheduleMaintenance(tx, actor, { assetId: asset.id, title: "Service", kind: "preventive", dueDate: "2026-11-30", repeatMonths: 3 }),
    );
    await run((tx) => startMaintenance(tx, actor, job.id));
    expect(await statusOf(asset.id)).toBe("under_maintenance");

    // Manual status changes can't bypass the open job.
    await expect(run((tx) => changeStatus(tx, actor, { assetId: asset.id, to: "available" }))).rejects.toThrow(/Complete that job/);

    await run((tx) => completeMaintenance(tx, actor, { maintenanceId: job.id, cost: "1500.00", notes: "replaced drum" }));
    expect(await statusOf(asset.id)).toBe("available");

    const jobs = await run((tx) => tx.select().from(maintenance).where(eq(maintenance.assetId, asset.id)).orderBy(asc(maintenance.createdAt)));
    expect(jobs.map((j) => [j.state, j.dueDate, j.cost])).toEqual([
      ["completed", "2026-11-30", "1500.00"],
      ["scheduled", "2027-02-28", null],
    ]);
    const events = await run((tx) => tx.select().from(assetEvents).where(eq(assetEvents.assetId, asset.id)).orderBy(asc(assetEvents.occurredAt)));
    expect(events.map((e) => e.type)).toEqual([
      "maintenance_scheduled",
      "maintenance_started",
      "maintenance_completed",
      "maintenance_scheduled",
    ]);
  });

  it("can return the asset as still broken", async () => {
    const asset = await newAsset();
    const job = await run((tx) => scheduleMaintenance(tx, actor, { assetId: asset.id, title: "Fix", kind: "repair" }));
    await run((tx) => startMaintenance(tx, actor, job.id));
    await run((tx) => completeMaintenance(tx, actor, { maintenanceId: job.id, result: "broken" }));
    expect(await statusOf(asset.id)).toBe("broken");
  });

  it("won't start on a checked-out asset, and only cancels scheduled jobs", async () => {
    const asset = await newAsset();
    const job = await run((tx) => scheduleMaintenance(tx, actor, { assetId: asset.id, title: "Check", kind: "preventive" }));
    await run((tx) => checkOut(tx, actor, { assetId: asset.id, holderType: "person", holderId: personId }));
    await expect(run((tx) => startMaintenance(tx, actor, job.id))).rejects.toThrow(/Check it in first/);

    await run((tx) => cancelMaintenance(tx, actor, { maintenanceId: job.id, reason: "not needed" }));
    await expect(run((tx) => cancelMaintenance(tx, actor, { maintenanceId: job.id }))).rejects.toThrow(/Only a scheduled job/);
    await expect(run((tx) => completeMaintenance(tx, actor, { maintenanceId: job.id }))).rejects.toThrow(/already closed/);
  });

  it("requires a due date for repeating schedules", async () => {
    const asset = await newAsset();
    await expect(
      run((tx) => scheduleMaintenance(tx, actor, { assetId: asset.id, title: "x", kind: "preventive", repeatMonths: 6 })),
    ).rejects.toThrow(/due date/);
  });
});
