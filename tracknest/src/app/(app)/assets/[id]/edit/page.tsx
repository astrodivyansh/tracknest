import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assets } from "@/db/schema";
import { AssetForm } from "@/components/asset-form";
import { requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/lookups";
import { card, h1 } from "@/lib/ui";
import { updateAsset } from "../../actions";

export default async function EditAssetPage({ params }: PageProps<"/assets/[id]/edit">) {
  const user = await requireUser("manager");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { asset, lookups } = await withOrg(user.orgId, async (tx) => ({
    asset: (await tx.select().from(assets).where(and(eq(assets.id, id), isNull(assets.deletedAt))))[0],
    lookups: await getLookups(tx),
  }));
  if (!asset) notFound();
  return (
    <>
      <h1 className={h1}>
        Edit {asset.tag} · {asset.name}
      </h1>
      <section className={card}>
        <AssetForm action={updateAsset.bind(null, id)} lookups={lookups} values={asset} submitLabel="Save changes" />
      </section>
    </>
  );
}
