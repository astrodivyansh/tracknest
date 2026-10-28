import { ActionForm } from "@/components/action-form";
import type { FormState } from "@/lib/form";
import type { Lookups } from "@/lib/lookups";
import { btn, input, label } from "@/lib/ui";

export const CONDITIONS = ["Good", "Fair", "Damaged", "Missing parts"];

type AssetValues = Partial<{
  tag: string;
  name: string;
  categoryId: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  purchaseDate: string | null;
  cost: string | null;
  locationId: string | null;
  departmentId: string | null;
  condition: string | null;
  notes: string | null;
}>;

export function AssetForm({
  action,
  lookups,
  values = {},
  submitLabel,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  lookups: Lookups;
  values?: AssetValues;
  submitLabel: string;
}) {
  const text = (name: keyof AssetValues, title: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={label}>
      {title}
      <input name={name} defaultValue={values[name] ?? ""} className={input} {...extra} />
    </label>
  );
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      {text("name", "Asset name *", { required: true, placeholder: "e.g. Dell Latitude 5440" })}
      {text("tag", "Asset tag", { placeholder: "Leave blank to auto-generate" })}
      <label className={label}>
        Category
        <select name="categoryId" defaultValue={values.categoryId ?? ""} className={input}>
          <option value="">—</option>
          {lookups.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Location
        <select name="locationId" defaultValue={values.locationId ?? ""} className={input}>
          <option value="">—</option>
          {lookups.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.siteName} — {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Department
        <select name="departmentId" defaultValue={values.departmentId ?? ""} className={input}>
          <option value="">—</option>
          {lookups.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Condition
        <select name="condition" defaultValue={values.condition ?? ""} className={input}>
          <option value="">—</option>
          {CONDITIONS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {text("brand", "Brand")}
      {text("model", "Model")}
      {text("serial", "Serial number")}
      {text("purchaseDate", "Purchase date", { type: "date" })}
      {text("cost", "Purchase cost", { inputMode: "decimal", placeholder: "0.00" })}
      <label className={`${label} sm:col-span-2`}>
        Notes
        <textarea name="notes" defaultValue={values.notes ?? ""} rows={3} className={input} />
      </label>
      <div className="sm:col-span-2">
        <button className={btn}>{submitLabel}</button>
      </div>
    </ActionForm>
  );
}
