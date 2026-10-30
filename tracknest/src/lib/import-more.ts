import { inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { assetRecords, assets, categories, customers, departments, inventoryItems, locations, maintenance, MAINTENANCE_KINDS, sites, warranties, RECORD_KINDS } from "@/db/schema";
import { assetSchema, optDate } from "./assets";
import { recordEvent, type Actor } from "./custody";
import { optText, reqText } from "./form";
import { fail, key, normDate, readRows } from "./import";
import { moveStock } from "./inventory";
import type { Action } from "./permissions";

type Result = { imported: number; skipped: number; ignored: string[] };
export type Importer = {
  title: string;
  /** Who may run it: an admin-only setup table, or a permission. */
  needs: "admin" | Action;
  template: string;
  notes: string[];
  run: (tx: Tx, actor: Actor, text: string) => Promise<Result>;
};

/** Validates every row first; any error stops the whole file. */
function parseAll<S extends z.ZodType>(rows: Record<string, string | undefined>[], lines: number[], schema: S) {
  const errors: string[] = [];
  const out = rows.map((r, i) => {
    const res = schema.safeParse(r);
    if (!res.success) errors.push(`Row ${lines[i]}: ${res.error.issues[0].message}`);
    return res.data as z.output<S>;
  });
  if (errors.length) fail(errors);
  return out;
}

const money = assetSchema.shape.cost;
const plainMoney = (v?: string) => v?.replace(/[,\s]/g, "");

/** Finds assets by tag; unknown tags stop the import. */
async function assetsByTag(tx: Tx, tags: string[], lines: number[]) {
  const upper = [...new Set(tags.map((t) => t.toUpperCase()))];
  const found = await tx
    .select({ id: assets.id, tag: assets.tag, purchaseDate: assets.purchaseDate })
    .from(assets)
    .where(inArray(sql`upper(${assets.tag})`, upper));
  const map = new Map(found.map((a) => [a.tag.toUpperCase(), a]));
  const errors = tags.flatMap((t, i) => (map.has(t.toUpperCase()) ? [] : [`Row ${lines[i]}: no asset has the tag ${t}.`]));
  if (errors.length) fail(errors);
  return map;
}

export const IMPORTERS: Record<string, Importer> = {
  customers: {
    title: "Customers",
    needs: "people",
    template: "name,company,email,phone,address,notes\r\nRohan Mehta,Sunrise Events,rohan@example.com,9800000000,,\r\n",
    notes: ["Only “name” is required. Customers whose name and email are already on file are skipped."],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { name: "name", customer: "name", company: "company", email: "email", phone: "phone", mobile: "phone", address: "address", notes: "notes" });
      const parsed = parseAll(
        rows,
        lines,
        z.object({
          name: reqText("Name"),
          company: optText,
          email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => v?.toLowerCase() || null),
          phone: optText,
          address: optText,
          notes: optText,
        }),
      );
      const id = (c: { name: string; email: string | null }) => `${key(c.name)}|${c.email ?? ""}`;
      const seen = new Set((await tx.select({ name: customers.name, email: customers.email }).from(customers).where(isNull(customers.deletedAt))).map(id));
      const fresh = parsed.filter((c) => !seen.has(id(c)) && !!seen.add(id(c)));
      if (fresh.length) await tx.insert(customers).values(fresh.map((c) => ({ ...c, orgId: actor.orgId })));
      return { imported: fresh.length, skipped: parsed.length - fresh.length, ignored };
    },
  },
  sites: {
    title: "Sites and locations",
    needs: "admin",
    template: "name,location,address\r\nHead Office,Floor 2,\r\nHead Office,Store Room,\r\n",
    notes: ["“name” is the site. Add a “location” column to create locations inside it. Ones already on file are skipped."],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { name: "name", site: "name", location: "location", address: "address" });
      const parsed = parseAll(rows, lines, z.object({ name: reqText("Site name"), location: optText, address: optText }));
      const siteIds = new Map((await tx.select().from(sites)).map((s) => [key(s.name), s.id]));
      const locKeys = new Set((await tx.select().from(locations)).map((l) => `${l.siteId}|${key(l.name)}`));
      let imported = 0;
      for (const r of parsed) {
        let siteId = siteIds.get(key(r.name));
        if (!siteId) {
          [{ id: siteId }] = await tx.insert(sites).values({ orgId: actor.orgId, name: r.name, address: r.address }).returning({ id: sites.id });
          siteIds.set(key(r.name), siteId);
          imported++;
        }
        const k = `${siteId}|${key(r.location ?? "")}`;
        if (r.location && !locKeys.has(k)) {
          await tx.insert(locations).values({ orgId: actor.orgId, siteId, name: r.location });
          locKeys.add(k);
          imported++;
        }
      }
      return { imported, skipped: 0, ignored };
    },
  },
  categories: {
    title: "Categories",
    needs: "admin",
    template: "name,parent\r\nIT equipment,\r\nLaptops,IT equipment\r\n",
    notes: ["“parent” makes it a sub-category and is created if missing. One level only. Ones already on file are skipped."],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { name: "name", category: "name", parent: "parent", parentcategory: "parent" });
      const parsed = parseAll(rows, lines, z.object({ name: reqText("Name"), parent: optText }));
      const all = await tx.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories);
      const byName = new Map(all.map((c) => [key(c.name), c]));
      let imported = 0;
      const ensure = async (name: string, parentId: string | null) => {
        const had = byName.get(key(name));
        if (had) return had;
        const [c] = await tx.insert(categories).values({ orgId: actor.orgId, name, parentId }).returning({ id: categories.id, name: categories.name, parentId: categories.parentId });
        byName.set(key(name), c);
        imported++;
        return c;
      };
      const errors: string[] = [];
      for (const [i, r] of parsed.entries()) {
        const p = r.parent ? await ensure(r.parent, null) : null;
        if (p?.parentId) errors.push(`Row ${lines[i]}: “${r.parent}” is already a sub-category.`);
        else await ensure(r.name, p?.id ?? null);
      }
      if (errors.length) fail(errors); // throwing rolls back the transaction
      return { imported, skipped: Math.max(0, parsed.length - imported), ignored };
    },
  },
  departments: {
    title: "Departments",
    needs: "admin",
    template: "name\r\nFinance\r\n",
    notes: ["Departments already on file are skipped."],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { name: "name", department: "name" });
      const parsed = parseAll(rows, lines, z.object({ name: reqText("Name") }));
      const seen = new Set((await tx.select({ n: departments.name }).from(departments)).map((d) => key(d.n)));
      const fresh = parsed.filter((d) => !seen.has(key(d.name)) && !!seen.add(key(d.name)));
      if (fresh.length) await tx.insert(departments).values(fresh.map((d) => ({ orgId: actor.orgId, name: d.name })));
      return { imported: fresh.length, skipped: parsed.length - fresh.length, ignored };
    },
  },
  warranties: {
    title: "Warranties",
    needs: "warranty",
    template: "tag,name,ends,notes\r\nTN-000001,Dell ProSupport,2028-03-31,\r\n",
    notes: ["“tag” finds the asset, “name” is the provider, “ends” is the end date. All three are required."],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { tag: "tag", assettag: "tag", name: "name", provider: "name", ends: "ends", expires: "ends", enddate: "ends", notes: "notes" });
      const parsed = parseAll(
        rows.map((r) => ({ ...r, ends: normDate(r.ends) })),
        lines,
        z.object({ tag: reqText("Tag"), name: reqText("Provider"), ends: z.iso.date("Ends must be a date like 2028-03-31"), notes: optText }),
      );
      const found = await assetsByTag(tx, parsed.map((r) => r.tag), lines);
      for (const r of parsed) {
        const asset = found.get(r.tag.toUpperCase())!;
        const [w] = await tx.insert(warranties).values({ orgId: actor.orgId, assetId: asset.id, provider: r.name, expiresOn: r.ends, notes: r.notes, createdBy: actor.name }).returning();
        await recordEvent(tx, actor, asset.id, "warranty_added", { warrantyId: w.id, provider: w.provider, expiresOn: w.expiresOn, notes: w.notes }, { source: "import" });
      }
      return { imported: parsed.length, skipped: 0, ignored };
    },
  },
  maintenance: {
    title: "Maintenance schedule",
    needs: "maintenance",
    template: "tag,name,type,due,vendor,notes\r\nTN-000001,Annual service,preventive,2027-01-15,HP Care,\r\n",
    notes: ["“tag” finds the asset, “name” is the job. “type” is preventive or repair (preventive if blank)."],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { tag: "tag", assettag: "tag", name: "name", job: "name", title: "name", type: "kind", kind: "kind", due: "dueDate", duedate: "dueDate", vendor: "vendor", notes: "notes" });
      const parsed = parseAll(
        rows.map((r) => ({ ...r, dueDate: normDate(r.dueDate), kind: r.kind?.toLowerCase() || "preventive" })),
        lines,
        z.object({ tag: reqText("Tag"), name: reqText("Job"), kind: z.enum(MAINTENANCE_KINDS, "Type must be preventive or repair"), dueDate: optDate, vendor: optText, notes: optText }),
      );
      const found = await assetsByTag(tx, parsed.map((r) => r.tag), lines);
      for (const r of parsed) {
        const asset = found.get(r.tag.toUpperCase())!;
        const [job] = await tx
          .insert(maintenance)
          .values({ orgId: actor.orgId, assetId: asset.id, title: r.name, kind: r.kind, dueDate: r.dueDate, vendor: r.vendor, notes: r.notes, createdBy: actor.name })
          .returning();
        await recordEvent(tx, actor, asset.id, "maintenance_scheduled", { maintenanceId: job.id, title: job.title, kind: job.kind, dueDate: job.dueDate, vendor: job.vendor }, { source: "import" });
      }
      return { imported: parsed.length, skipped: 0, ignored };
    },
  },
  inventory: {
    title: "Inventory items",
    needs: "inventory",
    template: "name,sku,unit,quantity,alert_level,unit_cost,notes\r\nHP 680 toner,TN-680,pcs,12,3,1450,\r\n",
    notes: ["Only “name” is required. “quantity” becomes the opening stock. Items with a name already on file are skipped."],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { name: "name", item: "name", sku: "sku", code: "sku", unit: "unit", quantity: "quantity", qty: "quantity", stock: "quantity", alertlevel: "minQuantity", minquantity: "minQuantity", unitcost: "unitCost", cost: "unitCost", notes: "notes" });
      const parsed = parseAll(
        rows.map((r) => ({ ...r, quantity: plainMoney(r.quantity), minQuantity: plainMoney(r.minQuantity), unitCost: plainMoney(r.unitCost) })),
        lines,
        z.object({ name: reqText("Name"), sku: optText, unit: optText, quantity: money, minQuantity: money, unitCost: money, notes: optText }),
      );
      const seen = new Set((await tx.select({ n: inventoryItems.name }).from(inventoryItems).where(isNull(inventoryItems.archivedAt))).map((i) => key(i.n)));
      let imported = 0;
      for (const r of parsed) {
        if (seen.has(key(r.name))) continue;
        seen.add(key(r.name));
        const [item] = await tx
          .insert(inventoryItems)
          .values({ orgId: actor.orgId, name: r.name, sku: r.sku, unit: r.unit ?? "pcs", minQuantity: r.minQuantity, unitCost: r.unitCost, notes: r.notes })
          .returning();
        if (Number(r.quantity) > 0) await moveStock(tx, actor, { itemId: item.id, kind: "received", quantity: Number(r.quantity), note: "Imported opening stock" });
        imported++;
      }
      return { imported, skipped: parsed.length - imported, ignored };
    },
  },
  records: {
    title: "Contracts, insurance and funding",
    needs: "records",
    template: "kind,name,reference,vendor,starts,ends,amount,notes\r\ncontract,Printer AMC,AMC-1,HP Care,2026-04-01,2027-03-31,25000,\r\n",
    notes: ["“kind” is contract, insurance or funding. Link them to assets afterwards on each record's page."],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { kind: "kind", type: "kind", name: "name", reference: "reference", number: "reference", vendor: "vendor", starts: "startDate", startdate: "startDate", ends: "endDate", enddate: "endDate", amount: "amount", value: "amount", notes: "notes" });
      const parsed = parseAll(
        rows.map((r) => ({ ...r, kind: r.kind?.toLowerCase(), startDate: normDate(r.startDate), endDate: normDate(r.endDate), amount: plainMoney(r.amount) })),
        lines,
        z.object({ kind: z.enum(RECORD_KINDS, "Kind must be contract, insurance or funding"), name: reqText("Name"), reference: optText, vendor: optText, startDate: optDate, endDate: optDate, amount: money, notes: optText }),
      );
      await tx.insert(assetRecords).values(parsed.map((r) => ({ ...r, orgId: actor.orgId, createdBy: actor.name })));
      return { imported: parsed.length, skipped: 0, ignored };
    },
  },
};
