"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scanner } from "../scan/scanner";
import { input, label } from "@/lib/ui";
import { scanAction } from "./actions";

export function AuditScanner({
  auditId,
  locations,
  defaultLocationId,
}: {
  auditId: string;
  locations: { id: string; name: string }[];
  defaultLocationId: string;
}) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(defaultLocationId);
  return (
    <div className="space-y-3">
      <label className={`${label} max-w-sm`}>
        I&apos;m scanning in
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={input}>
          <option value="">Unknown / not listed</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <Scanner
        submitLabel="Record"
        onScan={async (tag) => {
          const msg = await scanAction(auditId, tag, locationId);
          router.refresh();
          return msg;
        }}
      />
    </div>
  );
}
