import { ActionForm } from "@/components/action-form";
import { formLayout } from "@/lib/asset-form-setup";
import { inputName } from "@/lib/custom-fields";
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
  purchasedFrom: string | null;
  locationId: string | null;
  departmentId: string | null;
  condition: string | null;
  notes: string | null;
  custom: Record<string, unknown>;
}>;

type Field = ReturnType<typeof formLayout>[number];

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
  const text = (name: Exclude<keyof AssetValues, "custom">, title: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label key={name} className={label}>
      {title}
      <input name={name} defaultValue={values[name] ?? ""} className={input} {...extra} />
    </label>
  );
  const choice = (f: Field, name: string, options: { value: string; text: string }[]) => (
    <label key={f.key} className={label}>
      {f.label}
      {f.required && " *"}
      <select name={name} defaultValue={(values[f.key] as string | null) ?? ""} required={f.required} className={input}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
  const fieldFor = (f: Field) => {
    const title = `${f.label}${f.required ? " *" : ""}`;
    const req = { required: f.required };
    switch (f.key) {
      case "categoryId":
        return choice(f, f.key, lookups.categories.map((c) => ({ value: c.id, text: c.name })));
      case "locationId":
        return choice(f, f.key, lookups.locations.map((l) => ({ value: l.id, text: `${l.siteName} — ${l.name}` })));
      case "departmentId":
        return choice(f, f.key, lookups.departments.map((d) => ({ value: d.id, text: d.name })));
      case "condition":
        return choice(f, f.key, CONDITIONS.map((c) => ({ value: c, text: c })));
      case "purchaseDate":
        return text(f.key, title, { ...req, type: "date" });
      case "cost":
        return text(f.key, title, { ...req, inputMode: "decimal", placeholder: "0.00" });
      case "purchasedFrom":
        return text(f.key, title, { ...req, placeholder: "Vendor or shop" });
      case "notes":
        return (
          <label key={f.key} className={`${label} sm:col-span-2`}>
            {title}
            <textarea name="notes" defaultValue={values.notes ?? ""} rows={3} required={f.required} className={input} />
          </label>
        );
      default:
        return text(f.key, title, req);
    }
  };
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      {text("name", "Asset name *", { required: true, placeholder: "e.g. Dell Latitude 5440" })}
      {/* New assets are tagged from their category (DESK-000001) when saved; an existing tag can still be corrected. */}
      {values.tag ? text("tag", "Asset tag", { required: true }) : <p className="self-end text-sm text-muted-foreground">The asset tag is created from the category when you save, e.g. DESK-000001.</p>}
      {formLayout(lookups.assetForm).map((f) => fieldFor(f))}
      {lookups.customFields.map((f) => {
        const v = values.custom?.[f.id];
        const only = f.categoryId && lookups.categories.find((c) => c.id === f.categoryId)?.name;
        const title = `${f.label}${f.required ? " *" : ""}${only ? ` (${only} only)` : ""}`;
        if (f.type === "checkbox")
          return (
            <label key={f.id} className="flex items-center gap-2 self-end text-sm font-medium text-foreground">
              <input type="checkbox" name={inputName(f)} defaultChecked={v === true} /> {title}
            </label>
          );
        if (f.type === "multiselect")
          return (
            <fieldset key={f.id} className="space-y-1 text-sm">
              <legend className="font-medium text-foreground">{title}</legend>
              {f.options.map((o) => (
                <label key={o} className="mr-4 inline-flex items-center gap-1.5">
                  <input type="checkbox" name={inputName(f)} value={o} defaultChecked={Array.isArray(v) && v.includes(o)} /> {o}
                </label>
              ))}
            </fieldset>
          );
        const value = v === undefined || v === null ? "" : String(v);
        return (
          <label key={f.id} className={`${label} ${f.type === "textarea" ? "sm:col-span-2" : ""}`}>
            {title}
            {f.type === "select" ? (
              <select name={inputName(f)} defaultValue={value} className={input}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea name={inputName(f)} rows={3} defaultValue={value} className={input} />
            ) : (
              <input
                name={inputName(f)}
                type={{ date: "date", email: "email", url: "url" }[f.type as string] ?? "text"}
                inputMode={f.type === "number" || f.type === "currency" ? "decimal" : undefined}
                defaultValue={value}
                className={input}
              />
            )}
          </label>
        );
      })}
      <div className="sm:col-span-2">
        <button className={btn}>{submitLabel}</button>
      </div>
    </ActionForm>
  );
}
