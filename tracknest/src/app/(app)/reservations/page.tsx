import { and, asc, eq, gte } from "drizzle-orm";
import { withOrg } from "@/db";
import { assets, reservations } from "@/db/schema";
import { ReservationList } from "@/components/reservation-list";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { orgClock } from "@/lib/custody";
import { h1 } from "@/lib/ui";

export default async function ReservationsPage() {
  const user = await requireUser();
  const { today, rows } = await withOrg(user.orgId, async (tx) => {
    const { today } = await orgClock(tx, user.orgId);
    return {
      today,
      // shortcut: lists every upcoming booking; add a date filter if orgs book months ahead in bulk.
      rows: await tx
        .select({
          id: reservations.id,
          holderName: reservations.holderName,
          startDate: reservations.startDate,
          endDate: reservations.endDate,
          notes: reservations.notes,
          createdBy: reservations.createdBy,
          assetId: assets.id,
          assetTag: assets.tag,
          assetName: assets.name,
        })
        .from(reservations)
        .innerJoin(assets, eq(assets.id, reservations.assetId))
        .where(and(eq(reservations.state, "active"), gte(reservations.endDate, today)))
        .orderBy(asc(reservations.startDate), asc(assets.tag)),
    };
  });
  return (
    <>
      <div>
        <h1 className={h1}>Reservations</h1>
        <p className="text-sm text-muted-foreground">
          Book an asset from its page. Checking it out to the person who booked it completes the reservation.
        </p>
      </div>
      <ReservationList rows={rows} today={today} canEdit={can(user, "reserve")} showAsset />
    </>
  );
}
