"use client";

import { useState } from "react";
import { input } from "@/lib/ui";

/** Searchable checkbox list of assets; each ticked one is sent as a repeated `name` field. */
export function AssetPicker({ assets, name = "assetId" }: { assets: { id: string; tag: string; name: string }[]; name?: string }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  if (assets.length === 0) return <p className="text-sm text-muted-foreground">No other available assets.</p>;
  return (
    <div className="space-y-2">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by tag or name" aria-label="Search assets" className={input} />
      <div className="max-h-48 overflow-y-auto rounded-md border border-input p-2">
        {assets.map((a) => (
          // Hidden rather than removed, so ticks survive a search.
          <label key={a.id} hidden={!!needle && !`${a.tag} ${a.name}`.toLowerCase().includes(needle)} className="flex items-center gap-2 py-1 text-sm">
            <input type="checkbox" name={name} value={a.id} />
            <span className="font-mono text-xs text-muted-foreground">{a.tag}</span> {a.name}
          </label>
        ))}
      </div>
    </div>
  );
}
