import { WORK_LOCATION_LABEL, WORK_LOCATIONS } from "@/db/schema";
import type { Lookups } from "@/lib/lookups";
import { input, label } from "@/lib/ui";

type Person = {
  name: string;
  email: string | null;
  employeeId: string | null;
  departmentId: string | null;
  brand: string | null;
  designation: string | null;
  workLocation: string | null;
};

/** The person form fields, shared by "Add person" and "Edit details" (parsed by personSchema in people/actions.ts). */
export function PersonFields({ lookups, person }: { lookups: Lookups; person?: Person }) {
  return (
    <>
      <label className={label}>
        Name
        <input name="name" required defaultValue={person?.name} className={input} />
      </label>
      <label className={label}>
        Email
        <input name="email" type="email" defaultValue={person?.email ?? ""} className={input} />
      </label>
      <label className={label}>
        Employee ID
        <input name="employeeId" defaultValue={person?.employeeId ?? ""} className={input} />
      </label>
      <label className={label}>
        Designation
        <input name="designation" defaultValue={person?.designation ?? ""} placeholder="e.g. Sales Executive" className={input} />
      </label>
      <label className={label}>
        Brand / company
        <input name="brand" defaultValue={person?.brand ?? ""} className={input} />
      </label>
      <label className={label}>
        Department
        <select name="departmentId" defaultValue={person?.departmentId ?? ""} className={input}>
          <option value="">—</option>
          {lookups.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Work location
        <select name="workLocation" defaultValue={person?.workLocation ?? ""} className={input}>
          <option value="">—</option>
          {WORK_LOCATIONS.map((w) => (
            <option key={w} value={w}>
              {WORK_LOCATION_LABEL[w]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
