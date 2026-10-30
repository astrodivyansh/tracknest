import Link from "next/link";
import { and, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { FileText } from "lucide-react";
import { withOrg } from "@/db";
import { assetFiles, assets } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { btnSecondary, card, h1, input } from "@/lib/ui";

const PAGE_SIZE = 48;

/** Every photo or document across all assets. */
export default async function GalleryPage({ searchParams }: PageProps<"/gallery">) {
  const user = await requireUser();
  const sp = await searchParams;
  const kind = sp.kind === "document" ? "document" : "photo";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = and(
    eq(assetFiles.kind, kind),
    isNull(assets.deletedAt),
    q ? or(ilike(assets.tag, `%${q}%`), ilike(assets.name, `%${q}%`), ilike(assetFiles.filename, `%${q}%`)) : undefined,
  );
  const { rows, total } = await withOrg(user.orgId, async (tx) => ({
    total: (await tx.select({ n: count() }).from(assetFiles).innerJoin(assets, eq(assets.id, assetFiles.assetId)).where(where))[0].n,
    rows: await tx
      .select({ id: assetFiles.id, filename: assetFiles.filename, createdAt: assetFiles.createdAt, assetId: assets.id, tag: assets.tag, name: assets.name })
      .from(assetFiles)
      .innerJoin(assets, eq(assets.id, assetFiles.assetId))
      .where(where)
      .orderBy(desc(assetFiles.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  }));
  const href = (over: Record<string, string>) => `/gallery?${new URLSearchParams({ kind, ...(q && { q }), ...over })}`;

  return (
    <>
      <h1 className={h1}>Gallery</h1>
      <div className="flex flex-wrap items-center gap-2">
        {(["photo", "document"] as const).map((k) => (
          <Link
            key={k}
            href={`/gallery?kind=${k}`}
            aria-current={k === kind ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm ${k === kind ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
          >
            {k === "photo" ? "Photos" : "Documents"}
          </Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="kind" value={kind} />
          <input name="q" defaultValue={q} placeholder="Tag, asset or file name" aria-label="Search files" className={input} />
          <button className={btnSecondary}>Search</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className={`${card} text-sm text-muted-foreground`}>{q ? "Nothing matches." : `No ${kind}s yet. Add them on an asset's page.`}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {rows.map((f) => (
            <div key={f.id} className="overflow-hidden rounded-lg border border-border bg-card">
              <a href={`/files/${f.id}`} target="_blank" rel="noreferrer" className="block" aria-label={`Open ${f.filename}`}>
                {kind === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file; the image optimiser can't fetch it
                  <img src={`/files/${f.id}`} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                ) : (
                  <span className="flex aspect-square items-center justify-center bg-muted text-muted-foreground">
                    <FileText className="size-10" aria-hidden />
                  </span>
                )}
              </a>
              <div className="p-2 text-xs">
                <Link href={`/assets/${f.assetId}`} className="font-mono text-primary hover:underline">
                  {f.tag}
                </Link>
                <p className="truncate" title={f.name}>
                  {f.name}
                </p>
                <p className="truncate text-muted-foreground" title={f.filename}>
                  {f.filename} · {fmtDate(f.createdAt, user.timezone)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Pages" className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          {page > 1 && (
            <Link href={href({ page: String(page - 1) })} className={btnSecondary}>
              Previous
            </Link>
          )}
          {page * PAGE_SIZE < total && (
            <Link href={href({ page: String(page + 1) })} className={btnSecondary}>
              Next
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
