"use client";

import { useState } from "react";
import { addLocation, renameItem, removeItem } from "@/app/(app)/setup/actions";
import { ActionForm } from "@/components/action-form";
import { btn, input, label, td, th } from "@/lib/ui";
import { FormDialog } from "./dialog";

type Site = { id: string; name: string };
type Location = Site & { siteId: string };
const smallEdit = "rounded-md border border-border px-2 py-1 text-xs font-medium text-primary hover:bg-muted/50";

export function LocationsStep({ sites, locations }: { sites: Site[]; locations: Location[] }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const shown = locations.filter((l) => l.siteId === siteId);
  if (sites.length === 0) return <p className="text-sm text-muted-foreground">You haven&apos;t added a site yet. Go back to add one, or continue and add locations later under Setup.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className={`${label} w-full max-w-xs`}>
          Select a site
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={input}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <FormDialog title="Add a location" trigger="+ Add New Location" triggerClass={btn} submit="Add" action={addLocation}>
          <input type="hidden" name="siteId" value={siteId} />
          <label className={label}>
            Location
            <input name="name" required placeholder="e.g. Floor 2, Server room" className={input} />
          </label>
        </FormDialog>
      </div>
      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th className={th}>Location</th>
                <th className={`${th} w-16`}>Edit</th>
                <th className={`${th} w-16`}>Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((l) => (
                <tr key={l.id}>
                  <td className={td}>{l.name}</td>
                  <td className={td}>
                    <FormDialog title="Edit location" trigger="Edit" triggerClass={smallEdit} submit="Save" action={renameItem.bind(null, "location", l.id)}>
                      <label className={label}>
                        Location
                        <input name="name" required defaultValue={l.name} className={input} />
                      </label>
                    </FormDialog>
                  </td>
                  <td className={td}>
                    <ActionForm action={removeItem.bind(null, "location", l.id)}>
                      <button className="rounded-md border border-border px-2 py-1 text-xs font-medium text-red-600 hover:bg-muted/50 dark:text-red-400">Delete</button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
