import type { AssetFormSetup } from "@/db/schema";
import { CustodyError } from "./custody";

/** Standard asset form fields an admin can rename, hide, require and reorder. Name and tag are always there. */
export const FORM_FIELDS = [
  { key: "categoryId", label: "Category" },
  { key: "locationId", label: "Location" },
  { key: "departmentId", label: "Department" },
  { key: "condition", label: "Condition" },
  { key: "brand", label: "Brand" },
  { key: "model", label: "Model" },
  { key: "serial", label: "Serial number" },
  { key: "purchaseDate", label: "Purchase date" },
  { key: "cost", label: "Purchase cost" },
  { key: "purchasedFrom", label: "Purchased from" },
  { key: "notes", label: "Notes" },
] as const;
export type FormFieldKey = (typeof FORM_FIELDS)[number]["key"];

/** Visible fields in order, with their labels. */
export function formLayout(setup: AssetFormSetup) {
  return FORM_FIELDS.map((f, i) => ({ ...f, ...setup[f.key], label: setup[f.key]?.label || f.label, order: setup[f.key]?.position ?? i + 1, i }))
    .filter((f) => !f.hidden)
    .sort((a, b) => a.order - b.order || a.i - b.i);
}

/**
 * Applies the form setup to submitted values. Hidden fields aren't on the form, so an edit keeps
 * what's saved (never blanks it) and a new asset leaves them empty.
 */
export function applyFormSetup<T extends Partial<Record<FormFieldKey, string | null>>>(input: T, setup: AssetFormSetup, before?: Partial<Record<FormFieldKey, string | null>>): T {
  const out: Partial<Record<FormFieldKey, string | null>> = { ...input };
  for (const f of FORM_FIELDS) {
    const s = setup[f.key];
    if (s?.hidden) out[f.key] = before?.[f.key] ?? null;
    else if (s?.required && !out[f.key]) throw new CustodyError(`${s.label || f.label} is required.`);
  }
  return out as T;
}
