import type { FieldType } from "@/db/schema";
import { fmtDate } from "./format";

export type FieldDef = { id: string; label: string; type: FieldType; options: string[]; required: boolean; categoryId: string | null };
export type CustomValue = string | number | boolean | string[];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  textarea: "Long text",
  number: "Number",
  currency: "Money",
  date: "Date",
  select: "Dropdown",
  multiselect: "Multiple choice",
  checkbox: "Yes / no",
  email: "Email",
  url: "Web link",
};

/** Types with a list of options. */
export const HAS_OPTIONS: FieldType[] = ["select", "multiselect"];

/** Form input name for a field. */
export const inputName = (f: FieldDef) => `cf_${f.id}`;
export const appliesTo = (f: FieldDef, categoryId: string | null) => !f.categoryId || f.categoryId === categoryId;

function parseOne(f: FieldDef, raw: string): CustomValue | { error: string } {
  switch (f.type) {
    case "checkbox":
      return /^(on|true|yes|y|1)$/i.test(raw);
    case "number":
    case "currency": {
      const v = raw.replace(/[,\s₹$€£]/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(v)) return { error: `${f.label} must be a number.` };
      return f.type === "currency" ? Math.round(Number(v) * 100) / 100 : Number(v);
    }
    case "multiselect": {
      // One choice per line (the form) or separated by ";" (spreadsheets, where options may contain commas).
      const picked = raw.split(/[\n;]/).map((p) => p.trim()).filter(Boolean);
      const out = picked.map((p) => f.options.find((o) => o.toLowerCase() === p.toLowerCase()));
      return out.every(Boolean) ? [...new Set(out as string[])] : { error: `${f.label} must be from: ${f.options.join(", ")}.` };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : { error: `${f.label} must be an email address.` };
    case "url":
      try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : { error: `${f.label} must be a web link.` };
      } catch {
        return { error: `${f.label} must be a web link.` };
      }
    case "textarea":
      return raw.length <= 5000 ? raw : { error: `${f.label} is too long (5000 characters at most).` };
    case "date": {
      // YYYY-MM-DD, or DD/MM/YYYY as typed in India.
      const iso = raw.replace(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/, (_, d, m, y) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(iso) && new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso);
      return ok ? iso : { error: `${f.label} must be a date like 2026-12-31.` };
    }
    case "select": {
      const match = f.options.find((o) => o.toLowerCase() === raw.toLowerCase());
      return match ?? { error: `${f.label} must be one of: ${f.options.join(", ")}.` };
    }
    default:
      return raw.length <= 500 ? raw : { error: `${f.label} is too long (500 characters at most).` };
  }
}

/**
 * Validates raw values (by field id) for an asset in `categoryId`. Fields for other categories are
 * dropped; empty optional fields are left out.
 */
export function parseCustom(defs: FieldDef[], raw: Record<string, string | undefined>, categoryId: string | null) {
  const values: Record<string, CustomValue> = {};
  const errors: string[] = [];
  for (const f of defs.filter((d) => appliesTo(d, categoryId))) {
    const v = (raw[f.id] ?? "").trim();
    if (f.type === "checkbox") {
      values[f.id] = v !== "" && parseOne(f, v) === true;
      continue;
    }
    if (v === "") {
      if (f.required) errors.push(`${f.label} is required.`);
      continue;
    }
    const parsed = parseOne(f, v);
    if (typeof parsed === "object" && "error" in parsed) errors.push(parsed.error);
    else values[f.id] = parsed;
  }
  return { values, errors };
}

export function showCustom(f: FieldDef, v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  if (f.type === "checkbox") return v ? "Yes" : "No";
  if (f.type === "date") return fmtDate(v as string, "UTC"); // plain calendar date
  if (f.type === "number") return Number(v).toLocaleString("en-IN");
  if (f.type === "currency") return Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
