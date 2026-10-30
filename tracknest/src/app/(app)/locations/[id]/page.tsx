import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assets, locations, sites } from "@/db/schema";
import { AssetList } from "@/components/asset-list";
import { CustodyTable } from "@/components/custody-table";
import { requireUser } from "@/lib/auth";
import { checkoutsFor } from "@/lib/history";
import { h1, h2 } from "@/lib/ui";

const fields = { id: assets.id, tag: assets.tag, name: assets.name, status: assets.status };

export default async function LocationPage({ params }: PageProps<"/locations/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withOrg(user.orgId, async (tx) => {
    const [loc] = await tx
      .select({ name: locations.name, site: sites.name })
      .from(locations)
      .innerJoin(sites, eq(sites.id, locations.siteId))
      .where(eq(locations.id, id));
    if (!loc) return null;
    return {
      loc,
      // Where an asset lives (its home location), as opposed to a check-out to this location below.
      kept: await tx
        .select(fields)
        .from(assets)
        .where(and(eq(assets.locationId, id), isNull(assets.deletedAt), ne(assets.status, "disposed")))
        .orderBy(asc(assets.tag)),
      rows: await checkoutsFor(tx, "location", id),
    };
  });
  if (!data) notFound();
  const holding = data.rows.filter((r) => r.state === "open");

  return (
    <>
      <div>
        <Link href="/setup" className="text-sm text-primary hover:underline">
          ← Setup
        </Link>
        <h1 className={h1}>{data.loc.name}</h1>
        <p className="text-sm text-muted-foreground">Location at {data.loc.site}</p>
      </div>
      <section className="space-y-2">
        <h2 className={h2}>Kept here ({data.kept.length})</h2>
        <AssetList rows={data.kept} empty="No assets have this as their location." />
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Checked out to this location now ({holding.length})</h2>
        <CustodyTable rows={holding} tz={user.timezone} />
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Every check-out to this location ({data.rows.length})</h2>
        <CustodyTable rows={data.rows} tz={user.timezone} />
      </section>
    </>
  );
}
