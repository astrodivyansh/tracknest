import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { withOrg } from "@/db";
import { assets } from "@/db/schema";
import { canEdit, requireUser } from "@/lib/auth";
import { h1 } from "@/lib/ui";
import Link from "next/link";

/** Target of every QR label: /a/<tag> opens the asset, or offers to create it. */
export default async function TagLookup({ params }: PageProps<"/a/[tag]">) {
  const user = await requireUser();
  const tag = decodeURIComponent((await params).tag);
  const [asset] = await withOrg(user.orgId, (tx) =>
    tx
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.tag, tag), isNull(assets.deletedAt))),
  );
  if (asset) redirect(`/assets/${asset.id}`);
  return (
    <div className="space-y-3">
      <h1 className={h1}>No asset with tag {tag}</h1>
      {canEdit(user) && (
        <Link href={`/assets/new?tag=${encodeURIComponent(tag)}`} className="text-indigo-600 hover:underline">
          Create an asset with this tag
        </Link>
      )}
    </div>
  );
}
