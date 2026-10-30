import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assetEvents, assets, organizations, persons, reservations, users } from "@/db/schema";
import { checkOut, extendDue, nextTag, type Actor } from "./custody";
import { endOfDayIn, isoDateIn } from "./format";
import { cancelReservation, reserve } from "./reservations";

const TZ = "Asia/Kolkata";
const today = isoDateIn(new Date(), TZ);
const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const due = (n: number) => endOfDayIn(plus(n), TZ);

let actor: Actor;
let asha: string;
let ben: string;
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);
const newAsset = () =>
  run(async (tx) => (await tx.insert(assets).values({ orgId: actor.orgId, tag: await nextTag(tx, actor.orgId), name: "Projector" }).returning())[0]);
const book = (assetId: string, holderId: string, from: number, to: number) =>
  run((tx) => reserve(tx, actor, { assetId, holderType: "person", holderId, startDate: plus(from), endDate: plus(to) }));
const lend = (assetId: string, holderId: string, dueIn?: number) =>
  run((tx) => checkOut(tx, actor, { assetId, holderType: "person", holderId, dueAt: dueIn === undefined ? null : due(dueIn) }));

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Res ${Date.now()}`, timezone: TZ }).returning();
  const [u] = await db
    .insert(users)
    .values({ orgId: org.id, name: "Admin", email: `res-${Date.now()}@test.local`, passwordHash: "x", role: "owner" })
    .returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
  [asha, ben] = (await run((tx) => tx.insert(persons).values([{ orgId: org.id, name: "Asha" }, { orgId: org.id, name: "Ben" }]).returning())).map(
    (p) => p.id,
  );
});

describe("reservations", () => {
  it("refuses overlapping bookings and check-outs that run into someone else's booking", async () => {
    const a = await newAsset();
    await book(a.id, asha, 2, 4);
    await expect(book(a.id, ben, 3, 5)).rejects.toThrow(/already reserved for Asha/);
    await book(a.id, ben, 5, 6); // touching but not overlapping is fine

    await expect(lend(a.id, ben)).rejects.toThrow(/reserved for Asha/); // open-ended runs into Asha's booking
    await lend(a.id, ben, 1); // back before Asha's starts
    await expect(run((tx) => extendDue(tx, actor, { assetId: a.id, dueAt: due(3) }))).rejects.toThrow(/reserved for Asha/);
  });

  it("checking out to the person who booked it fulfils the booking and takes its end date", async () => {
    const a = await newAsset();
    const r = await book(a.id, asha, 0, 2);
    const co = await lend(a.id, asha);
    expect(co.dueAt?.toISOString()).toBe(due(2).toISOString());
    const [after] = await run((tx) => tx.select().from(reservations).where(eq(reservations.id, r.id)));
    expect(after).toMatchObject({ state: "fulfilled", checkoutId: co.id });
  });

  it("only books dates after a current check-out is due back", async () => {
    const a = await newAsset();
    await lend(a.id, asha, 1);
    await expect(book(a.id, ben, 1, 2)).rejects.toThrow(/checked out to Asha until/);
    await book(a.id, ben, 2, 3);
    await expect(book(a.id, ben, -1, 0)).rejects.toThrow(/in the past/);
  });

  it("the database refuses overlaps even without the app's check", async () => {
    const a = await newAsset();
    const row = { orgId: actor.orgId, assetId: a.id, holderType: "person" as const, holderId: asha, holderName: "Asha", createdBy: "t" };
    await run((tx) => tx.insert(reservations).values({ ...row, startDate: plus(10), endDate: plus(12) }));
    await expect(run((tx) => tx.insert(reservations).values({ ...row, startDate: plus(12), endDate: plus(13) }))).rejects.toMatchObject({
      cause: { code: "23P01" },
    });
  });

  it("cancelling is recorded and frees the dates", async () => {
    const a = await newAsset();
    const r = await book(a.id, asha, 3, 4);
    await run((tx) => cancelReservation(tx, actor, { reservationId: r.id, reason: "event moved" }));
    await expect(run((tx) => cancelReservation(tx, actor, { reservationId: r.id }))).rejects.toThrow(/no longer active/);
    await book(a.id, ben, 3, 4);
    const types = (await run((tx) => tx.select().from(assetEvents).where(eq(assetEvents.assetId, a.id)).orderBy(assetEvents.occurredAt))).map(
      (e) => e.type,
    );
    expect(types).toEqual(["reserved", "reservation_cancelled", "reserved"]);
  });
});
