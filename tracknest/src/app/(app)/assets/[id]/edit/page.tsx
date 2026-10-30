import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assets } from "@/db/schema";
import { AssetForm } from "@/components/asset-form";
import { ActionForm } from "@/components/action-form";
import { isAdmin, requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/lookups";
import { btnSecondary, card, h1, h2, input } from "@/lib/ui";
import { archiveAssetAction, updateAsset } from "../../actions";

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
      {isAdmin(user) && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium text-red-700 dark:text-red-400">Archive this asset</summary>
          <h2 className={`${h2} mt-3`}>Added by mistake, or a duplicate?</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Archiving hides it from lists and reports. Its history is kept and its tag can&apos;t be reused. If the asset was sold,
            scrapped or written off, use “Dispose” on the asset page instead.
          </p>
          <ActionForm action={archiveAssetAction.bind(null, id)} className="flex flex-wrap gap-2">
            <input name="reason" required placeholder="Reason, e.g. duplicate of TN-000123" aria-label="Reason" className={`${input} max-w-md`} />
            <button className={`${btnSecondary} text-red-700 dark:text-red-400`}>Archive asset</button>
          </ActionForm>
        </details>
      )}
    </>
  );
}
