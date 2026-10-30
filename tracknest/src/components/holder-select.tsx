import type { Lookups } from "@/lib/lookups";
import { input } from "@/lib/ui";

/** Person, location, department or customer (a lease), sent as "person:<id>" (parsed by holderSchema in lib/assets.ts). */
export function HolderSelect({ lookups, name = "holder" }: { lookups: Lookups; name?: string }) {
  return (
    <select name={name} required defaultValue="" className={input}>
      <option value="" disabled>
        Choose a person, location, department or customer
      </option>
      <optgroup label="People">
        {lookups.persons.map((p) => (
          <option key={p.id} value={`person:${p.id}`}>
            {p.name}
            {p.employeeId ? ` (${p.employeeId})` : ""}
          </option>
        ))}
      </optgroup>
      <optgroup label="Locations">
        {lookups.locations.map((l) => (
          <option key={l.id} value={`location:${l.id}`}>
            {l.siteName} — {l.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Departments">
        {lookups.departments.map((d) => (
          <option key={d.id} value={`department:${d.id}`}>
            {d.name}
          </option>
        ))}
      </optgroup>
      {lookups.customers.length > 0 && (
        <optgroup label="Customers (lease)">
          {lookups.customers.map((c) => (
            <option key={c.id} value={`customer:${c.id}`}>
              {c.name}
              {c.company ? ` (${c.company})` : ""}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
