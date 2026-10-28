import { withOrg } from "@/db";
import { AssetForm } from "@/components/asset-form";
import { requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/lookups";
import { card, h1 } from "@/lib/ui";
import { createAsset } from "../actions";

export default async function NewAssetPage({ searchParams }: PageProps<"/assets/new">) {
  const user = await requireUser("manager");
  const lookups = await withOrg(user.orgId, getLookups);
  const { tag } = await searchParams; // set when an unknown pre-printed tag is scanned
  return (
    <>
      <h1 className={h1}>Add asset</h1>
      <section className={card}>
        <AssetForm
          action={createAsset}
          lookups={lookups}
          values={{ tag: typeof tag === "string" ? tag : "" }}
          submitLabel="Save asset"
        />
      </section>
    </>
  );
}
