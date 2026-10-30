import Link from "next/link";
import { and, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import bwipjs from "bwip-js/node";
import { withOrg } from "@/db";
import { assets } from "@/db/schema";
import { assetFilters } from "@/lib/assets";
import { appOrigin, requireUser } from "@/lib/auth";
import { btn, btnSecondary, h1, input } from "@/lib/ui";
import { PrintButton } from "./print-button";

const MAX_LABELS = 500;

// Physical sizes in mm. "sheet" matches common A4 21-up label sheets (e.g. Avery L7160).
const TEMPLATES = {
  sheet: {
    name: "A4 sheet, 21 per page (63.5 × 38.1 mm)",
    page: "A4",
    pageMargin: "15.1mm 7.2mm",
    cols: 3,
    w: 63.5,
    h: 38.1,
    gap: 2.5,
    qr: 30,
  },
  roll: { name: "Label printer roll (50 × 25 mm)", page: "50mm 25mm", pageMargin: "0", cols: 1, w: 50, h: 25, gap: 0, qr: 21 },
} as const;
type TemplateKey = keyof typeof TEMPLATES;

export default async function LabelsPage({ searchParams }: PageProps<"/labels">) {
  const user = await requireUser();
  const sp = await searchParams;
  const ids = [sp.id ?? []].flat().filter((v) => z.uuid().safeParse(v).success);
  const key: TemplateKey = sp.template === "roll" ? "roll" : "sheet";
  const t = TEMPLATES[key];

  const rows =
    ids.length > 0 || sp.all === "1"
      ? await withOrg(user.orgId, (tx) =>
          tx
            .select({ id: assets.id, tag: assets.tag, name: assets.name })
            .from(assets)
            .where(and(...assetFilters(sp).where, ids.length > 0 ? inArray(assets.id, ids) : undefined))
            .orderBy(asc(assets.tag))
            .limit(MAX_LABELS),
        )
      : [];

  const origin = await appOrigin();
  const labels = rows.map((a) => ({
    ...a,
    qr: bwipjs.toSVG({ bcid: "qrcode", text: `${origin}/a/${encodeURIComponent(a.tag)}` }),
  }));

  // Keep the current selection when switching template.
  const keep = Object.entries(sp).flatMap(([k, v]) =>
    k === "template" ? [] : [v ?? []].flat().map((x) => <input key={`${k}${x}`} type="hidden" name={k} value={x} />),
  );

  return (
    <>
      <style>{`
        @page { size: ${t.page}; margin: ${t.pageMargin}; }
        .label-grid { display: grid; grid-template-columns: repeat(${t.cols}, ${t.w}mm); gap: 0 ${t.gap}mm; }
        .label { width: ${t.w}mm; height: ${t.h}mm; break-inside: avoid; overflow: hidden; }
        .label svg { width: ${t.qr - 4}mm; height: ${t.qr - 4}mm; }
        ${key === "roll" ? ".label { break-after: page; }" : ""}
      `}</style>

      <div className="space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className={h1}>Print labels ({labels.length})</h1>
          <Link href="/assets" className={btnSecondary}>
            Back to assets
          </Link>
        </div>
        {labels.length === 0 ? (
          <p className="text-sm text-gray-600">
            No assets selected. Tick assets on the <Link href="/assets" className="text-indigo-600 hover:underline">assets page</Link>,
            then choose “Print labels”.
          </p>
        ) : (
          <form className="flex flex-wrap items-center gap-2">
            {keep}
            <select name="template" defaultValue={key} aria-label="Label size" className={`${input} max-w-sm`}>
              {Object.entries(TEMPLATES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name}
                </option>
              ))}
            </select>
            <button className={btnSecondary}>Apply</button>
            <PrintButton className={btn} />
          </form>
        )}
        {rows.length === MAX_LABELS && <p className="text-sm text-amber-700">Showing the first {MAX_LABELS}. Print in batches.</p>}
        <p className="text-xs text-gray-500">
          In the print dialog set scale to 100% (not “fit to page”) and margins to “default” so labels line up with the sheet.
        </p>
      </div>

      <div className="label-grid mt-4 print:mt-0">
        {labels.map((l) => (
          <div key={l.id} className="label flex items-center gap-[2mm] bg-white p-[2mm] outline outline-1 outline-gray-200 print:outline-0">
            <div className="shrink-0" dangerouslySetInnerHTML={{ __html: l.qr }} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[7pt] text-gray-600">{user.orgName}</p>
              <p className="font-mono text-[10pt] font-bold">{l.tag}</p>
              <p className="line-clamp-2 text-[7pt]">{l.name}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
