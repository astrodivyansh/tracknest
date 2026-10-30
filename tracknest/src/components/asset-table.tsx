"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Columns3, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BULK, type BulkKind } from "@/lib/labels";
import { td, th } from "@/lib/ui";

/** One asset, already formatted on the server (dates in the org's timezone, money in its currency). */
export type AssetRow = {
  id: string;
  tag: string;
  name: string;
  photoId: string | null;
  category: string | null;
  location: string | null;
  department: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  purchaseDate: string | null;
  cost: string | null;
  status: string;
  statusClass: string;
  holder: string | null;
  due: string | null;
};

type Key = Exclude<keyof AssetRow, "id" | "tag" | "statusClass">;
const COLUMNS: { key: Key; label: string; on: boolean }[] = [
  { key: "photoId", label: "Photo", on: true },
  { key: "name", label: "Name", on: true },
  { key: "category", label: "Category", on: true },
  { key: "location", label: "Location", on: true },
  { key: "department", label: "Department", on: false },
  { key: "brand", label: "Brand", on: false },
  { key: "model", label: "Model", on: false },
  { key: "serial", label: "Serial no.", on: false },
  { key: "purchaseDate", label: "Purchase date", on: false },
  { key: "cost", label: "Cost", on: false },
  { key: "status", label: "Status", on: true },
  { key: "holder", label: "Held by", on: true },
  { key: "due", label: "Due", on: true },
];

// Column choice is remembered per browser (localStorage), like AssetTiger's "Setup Columns".
const STORE = "tn-asset-columns";
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(STORE, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(STORE, cb);
  };
};
const read = () => {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null; // private mode or blocked storage: fall back to the defaults
  }
};

export function AssetTable({ rows, empty, bulk }: { rows: AssetRow[]; empty: string; bulk: BulkKind[] }) {
  const saved = useSyncExternalStore(subscribe, read, () => null);
  const shown = useMemo(() => {
    try {
      return new Set<Key>(saved ? JSON.parse(saved) : COLUMNS.filter((c) => c.on).map((c) => c.key));
    } catch {
      return new Set<Key>(COLUMNS.filter((c) => c.on).map((c) => c.key));
    }
  }, [saved]);
  const toggle = (k: Key) => {
    const next = new Set(shown);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    try {
      localStorage.setItem(STORE, JSON.stringify([...next]));
    } catch {}
    window.dispatchEvent(new Event(STORE));
  };
  const [selected, setSelected] = useState(0);
  const cols = COLUMNS.filter((c) => shown.has(c.key));

  const cell = (a: AssetRow, k: Key) => {
    if (k === "photoId")
      return a.photoId ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file; the image optimiser can't fetch it
        <img src={`/files/${a.photoId}`} alt="" className="size-9 rounded object-cover" loading="lazy" />
      ) : (
        <span className="flex size-9 items-center justify-center rounded bg-muted text-muted-foreground">
          <ImageOff className="size-4" aria-label="No photo" />
        </span>
      );
    if (k === "status") return <span className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${a.statusClass}`}>{a.status}</span>;
    return a[k] ?? "—";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {selected > 0 ? `${selected} selected:` : bulk.length ? "Tick assets to act on several at once." : "Tick assets to print their labels."}
          </p>
          {/* Submit the surrounding GET form (the ticked ids) to the bulk page instead of /labels. */}
          {selected > 0 &&
            bulk.map((k) => (
              <Button key={k} type="submit" name="do" value={k} formAction="/assets/bulk" variant="outline" size="sm">
                {BULK[k]}
              </Button>
            ))}
          {selected > 0 && (
            <Button type="submit" variant="outline" size="sm">
              Print labels
            </Button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Columns3 /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem key={c.key} checked={shown.has(c.key)} onCheckedChange={() => toggle(c.key)} onSelect={(e) => e.preventDefault()}>
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className="overflow-x-auto rounded-lg border border-border bg-card"
        onChange={(e) => {
          const box = e.target as HTMLInputElement;
          const table = e.currentTarget;
          if (box.dataset.all !== undefined) table.querySelectorAll<HTMLInputElement>('input[name="id"]').forEach((b) => (b.checked = box.checked));
          setSelected(table.querySelectorAll('input[name="id"]:checked').length);
        }}
      >
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className={`${th} w-8`}>
                <input type="checkbox" data-all aria-label="Select all on this page" />
              </th>
              <th className={th}>Tag</th>
              {cols.map((c) => (
                <th key={c.key} className={`${th} ${c.key === "cost" ? "text-right" : ""}`}>
                  {c.key === "photoId" ? <span className="sr-only">{c.label}</span> : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-muted/40">
                <td className={td}>
                  <input type="checkbox" name="id" value={a.id} aria-label={`Select ${a.tag}`} />
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <Link href={`/assets/${a.id}`} className="font-mono font-medium text-primary hover:underline">
                    {a.tag}
                  </Link>
                </td>
                {cols.map((c) => (
                  <td key={c.key} className={`${td} ${c.key === "cost" ? "text-right whitespace-nowrap" : ""} ${c.key === "photoId" ? "py-1" : ""}`}>
                    {cell(a, c.key)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className={`${td} text-muted-foreground`}>
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
