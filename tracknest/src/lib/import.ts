import { inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { assetEvents, assets, categories, customFields, departments, locations, persons, sites, WORK_LOCATIONS } from "@/db/schema";
import { assetSchema } from "./assets";
import { parseCsv } from "./csv";
import { parseCustom } from "./custom-fields";
import { CustodyError, nextTags, type Actor } from "./custody";
import { optText, reqText } from "./form";

export const MAX_IMPORT_ROWS = 5000;
const MAX_ERRORS_SHOWN = 20;
const CHUNK = 500;

// Normalised header (lowercase, letters/digits only) → field name.
const ASSET_HEADERS: Record<string, string> = {
  tag: "tag", assettag: "tag", name: "name", assetname: "name", category: "category",
  brand: "brand", make: "brand", model: "model", serial: "serial", serialnumber: "serial", serialno: "serial",
  purchasedate: "purchaseDate", cost: "cost", purchasecost: "cost", price: "cost",
  purchasedfrom: "purchasedFrom", vendor: "purchasedFrom", supplier: "purchasedFrom",
  site: "site", location: "location", department: "department", condition: "condition", notes: "notes",
};
const PERSON_HEADERS: Record<string, string> = {
  name: "name", fullname: "name", email: "email", emailaddress: "email",
  employeeid: "employeeId", empid: "employeeId", employeeno: "employeeId", department: "department",
  designation: "designation", jobtitle: "designation", title: "designation",
  brand: "brand", company: "brand", worklocation: "workLocation", workmode: "workLocation",
};

export const ASSET_TEMPLATE =
  "tag,name,category,brand,model,serial,purchase_date,cost,purchased_from,site,location,department,condition,notes\r\n" +
  ",Dell Latitude 5440,Laptops,Dell,Latitude 5440,8XK2L93,2026-04-15,85000,Croma,Head Office,Floor 2,Finance,Good,\r\n";
export const PERSON_TEMPLATE =
  "name,email,employee_id,designation,brand,department,work_location\r\nPriya Sharma,priya@example.com,E1042,Sales Executive,Acme Retail,Finance,office\r\n";

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Parses the file and renames known headers to field names. */
export function readRows(text: string, headerMap: Record<string, string>) {
  const { headers, rows, lines } = parseCsv(text);
  const field = (h: string) => headerMap[norm(h)];
  const ignored = headers.filter((h) => h && !field(h));
  if (!headers.some((h) => field(h) === "name")) throw new CustodyError("The file needs a “name” column.");
  if (rows.length === 0) throw new CustodyError("The file has no rows to import.");
  if (rows.length > MAX_IMPORT_ROWS) throw new CustodyError(`At most ${MAX_IMPORT_ROWS} rows per file; split it up.`);
  const mapped = rows.map((r) =>
    Object.fromEntries(Object.entries(r).flatMap(([h, v]) => (field(h) ? [[field(h), v]] : []))),
  );
  return { rows: mapped, ignored, lines };
}

export function fail(errors: string[]): never {
  const more = errors.length > MAX_ERRORS_SHOWN ? `\n…and ${errors.length - MAX_ERRORS_SHOWN} more.` : "";
  throw new CustodyError(`Nothing was imported. Fix these rows and upload again:\n${errors.slice(0, MAX_ERRORS_SHOWN).join("\n")}${more}`);
}

export const key = (s: string) => s.trim().toLowerCase();

// "15/04/2026" or "15-04-2026" (day first) → "2026-04-15"; anything else is left for validation.
export const normDate = (v = "") => v.replace(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/, (_, d, m, y) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);

const assetRow = assetSchema
  .omit({ categoryId: true, locationId: true, departmentId: true })
  .extend({ category: optText, site: optText, location: optText, department: optText });

/** Finds named categories/departments, creating the missing ones. */
async function idsByName(tx: Tx, orgId: string, table: typeof categories | typeof departments, names: (string | null)[]) {
  const existing = await tx.select({ id: table.id, name: table.name }).from(table);
  const map = new Map(existing.map((r) => [key(r.name), r.id]));
  const missing = [...new Map(names.filter((n): n is string => !!n && !map.has(key(n))).map((n) => [key(n), n])).values()];
  if (missing.length) {
    const created = await tx.insert(table).values(missing.map((name) => ({ orgId, name }))).returning({ id: table.id, name: table.name });
    created.forEach((r) => map.set(key(r.name), r.id));
  }
  return map;
}

/** All-or-nothing: either every row is imported or none is and the errors are reported. */
export async function importAssets(tx: Tx, actor: Actor, text: string) {
  // Columns named like a custom field fill it; built-in columns win on a name clash.
  const defs = await tx.select().from(customFields);
  const headerMap = { ...Object.fromEntries(defs.map((d) => [norm(d.label), `cf:${d.id}`])), ...ASSET_HEADERS };
  const { rows, ignored, lines } = readRows(text, headerMap);
  // Existing categories decide which category-only fields apply (new categories have none).
  const catIds = new Map((await tx.select({ id: categories.id, name: categories.name }).from(categories)).map((c) => [key(c.name), c.id]));
  const errors: string[] = [];
  const parsed = rows.map((r, i) => {
    const res = assetRow.safeParse({ ...r, purchaseDate: normDate(r.purchaseDate), cost: r.cost?.replace(/[,\s]/g, "") });
    if (!res.success) errors.push(`Row ${lines[i]}: ${res.error.issues[0].message}`);
    const raw = Object.fromEntries(defs.map((d) => [d.id, r[`cf:${d.id}`]]));
    const custom = parseCustom(defs, raw, r.category ? (catIds.get(key(r.category)) ?? null) : null);
    custom.errors.forEach((e) => errors.push(`Row ${lines[i]}: ${e}`));
    return res.data && { ...res.data, custom: custom.values };
  });
  if (errors.length) fail(errors);
  const valid = parsed as NonNullable<(typeof parsed)[number]>[];

  // Tags must be unique in the file and in the org.
  const given = valid.flatMap((r) => (r.tag ? [r.tag] : []));
  const taken = new Set(
    given.length ? (await tx.select({ tag: assets.tag }).from(assets).where(inArray(assets.tag, given))).map((r) => r.tag) : [],
  );
  const seen = new Set<string>();
  valid.forEach((r, i) => {
    if (!r.tag) return;
    if (taken.has(r.tag)) errors.push(`Row ${lines[i]}: tag ${r.tag} is already used by another asset.`);
    else if (seen.has(r.tag)) errors.push(`Row ${lines[i]}: tag ${r.tag} appears twice in the file.`);
    seen.add(r.tag);
  });

  // Locations need an existing site; match by name, narrowed by site when given.
  const allLocs = await tx.select({ id: locations.id, name: locations.name, siteId: locations.siteId }).from(locations);
  const allSites = await tx.select({ id: sites.id, name: sites.name }).from(sites);
  const siteByName = new Map(allSites.map((s) => [key(s.name), s.id]));
  const placed = valid.map((r, i) => {
    const siteId = r.site ? siteByName.get(key(r.site)) : undefined;
    if (r.site && !siteId) {
      errors.push(`Row ${lines[i]}: site “${r.site}” doesn't exist. Add it under Setup first.`);
      return { siteId: null, locationId: null };
    }
    if (!r.location) return { siteId: siteId ?? null, locationId: null };
    const matches = allLocs.filter((l) => key(l.name) === key(r.location!) && (!siteId || l.siteId === siteId));
    if (matches.length === 1) return { siteId: matches[0].siteId, locationId: matches[0].id };
    errors.push(
      matches.length === 0
        ? `Row ${lines[i]}: location “${r.location}”${r.site ? ` at ${r.site}` : ""} doesn't exist. Add it under Setup first.`
        : `Row ${lines[i]}: more than one site has a location “${r.location}”; add a site column.`,
    );
    return { siteId: null, locationId: null };
  });
  if (errors.length) fail(errors);

  const cats = await idsByName(tx, actor.orgId, categories, valid.map((r) => r.category));
  const depts = await idsByName(tx, actor.orgId, departments, valid.map((r) => r.department));
  const categoryOf = (r: (typeof valid)[number]) => (r.category ? cats.get(key(r.category))! : null);
  const tags = await nextTags(tx, actor.orgId, valid.filter((r) => !r.tag).map(categoryOf));

  const values = valid.map((r, i) => ({
    orgId: actor.orgId,
    tag: r.tag ?? tags.shift()!,
    name: r.name,
    brand: r.brand,
    model: r.model,
    serial: r.serial,
    purchaseDate: r.purchaseDate,
    cost: r.cost,
    purchasedFrom: r.purchasedFrom,
    condition: r.condition,
    notes: r.notes,
    custom: r.custom,
    categoryId: categoryOf(r),
    departmentId: r.department ? depts.get(key(r.department))! : null,
    ...placed[i],
  }));
  for (let i = 0; i < values.length; i += CHUNK) {
    const inserted = await tx.insert(assets).values(values.slice(i, i + CHUNK)).returning({ id: assets.id, tag: assets.tag, name: assets.name });
    await tx.insert(assetEvents).values(
      inserted.map((a) => ({
        orgId: actor.orgId,
        assetId: a.id,
        type: "created" as const,
        payload: { tag: a.tag, name: a.name },
        source: "import" as const,
        actorId: actor.id,
        actorName: actor.name,
      })),
    );
  }
  return { imported: values.length, skipped: 0, ignored };
}

// "Office", "Work from office", "WFO" → office; anything else is reported as an error.
const WORK_LOCATION_ALIASES: Record<string, (typeof WORK_LOCATIONS)[number]> = {
  office: "office", workfromoffice: "office", wfo: "office", home: "home", workfromhome: "home", wfh: "home", remote: "home",
};

const personRow = z.object({
  name: reqText("Name"),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => v?.toLowerCase() || null),
  employeeId: optText,
  department: optText,
  designation: optText,
  brand: optText,
  workLocation: z
    .string()
    .optional()
    .transform((v): string | null => (v?.trim() ? (WORK_LOCATION_ALIASES[norm(v)] ?? v) : null))
    .pipe(z.enum(WORK_LOCATIONS, "Work location must be office or home").nullable()),
});

/** Rows whose email or employee ID already exists (or repeats in the file) are skipped, so re-uploading is safe. */
export async function importPeople(tx: Tx, actor: Actor, text: string) {
  const { rows, ignored, lines } = readRows(text, PERSON_HEADERS);
  const errors: string[] = [];
  const parsed = rows.map((r, i) => {
    const res = personRow.safeParse(r);
    if (!res.success) errors.push(`Row ${lines[i]}: ${res.error.issues[0].message}`);
    return res.data;
  });
  if (errors.length) fail(errors);
  const valid = parsed as NonNullable<(typeof parsed)[number]>[];

  const existing = await tx.select({ email: persons.email, employeeId: persons.employeeId }).from(persons).where(isNull(persons.deletedAt));
  const emails = new Set(existing.flatMap((p) => (p.email ? [key(p.email)] : [])));
  const empIds = new Set(existing.flatMap((p) => (p.employeeId ? [key(p.employeeId)] : [])));
  const fresh = valid.filter((p) => {
    if ((p.email && emails.has(p.email)) || (p.employeeId && empIds.has(key(p.employeeId)))) return false;
    if (p.email) emails.add(p.email);
    if (p.employeeId) empIds.add(key(p.employeeId));
    return true;
  });

  const depts = await idsByName(tx, actor.orgId, departments, fresh.map((p) => p.department));
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    if (chunk.length)
      await tx.insert(persons).values(
        chunk.map((p) => ({
          orgId: actor.orgId,
          name: p.name,
          email: p.email,
          employeeId: p.employeeId,
          designation: p.designation,
          brand: p.brand,
          workLocation: p.workLocation,
          departmentId: p.department ? depts.get(key(p.department))! : null,
        })),
      );
  }
  return { imported: fresh.length, skipped: valid.length - fresh.length, ignored };
}
