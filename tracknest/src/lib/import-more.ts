import { eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { assetRecords, assets, categories, customers, departments, inventoryItems, locations, maintenance, MAINTENANCE_KINDS, organizations, persons, sites, subscriptions, warranties, RECORD_KINDS } from "@/db/schema";
import { assetSchema, optDate } from "./assets";
import { recordEvent, type Actor } from "./custody";
import { optText, reqText } from "./form";
import { fail, key, normDate, readRows } from "./import";
import { moveStock } from "./inventory";
import { addMonths } from "./maintenance";
import type { Action } from "./permissions";
import { nextSubscriptionTag } from "./subscriptions";

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

// "Monthly", "yearly", "annual" or a number of months → months.
const PERIOD_WORDS: Record<string, number> = { monthly: 1, month: 1, quarterly: 3, quarter: 3, halfyearly: 6, halfyear: 6, yearly: 12, annual: 12, annually: 12, year: 12 };

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
    template:
      "name,location,description,address,suite,city,state,postal_code,country\r\n" +
      "Head Office,Floor 2,Main building,12 MG Road,Block B,Noida,Uttar Pradesh,201301,India\r\nHead Office,Store Room,,,,,,,\r\n",
    notes: [
      "“name” is the site. Add a “location” column to create locations inside it. Ones already on file are skipped.",
      "Address columns are read from a site's first row; sites already on file keep their address.",
    ],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, {
        name: "name", site: "name", location: "location", description: "description", address: "address",
        suite: "suite", apt: "suite", aptsuite: "suite", city: "city", state: "state",
        postalcode: "postalCode", pincode: "postalCode", zip: "postalCode", zipcode: "postalCode", country: "country",
      });
      const parsed = parseAll(
        rows,
        lines,
        z.object({ name: reqText("Site name"), location: optText, description: optText, address: optText, suite: optText, city: optText, state: optText, postalCode: optText, country: optText }),
      );
      const siteIds = new Map((await tx.select().from(sites)).map((s) => [key(s.name), s.id]));
      const locKeys = new Set((await tx.select().from(locations)).map((l) => `${l.siteId}|${key(l.name)}`));
      let imported = 0;
      for (const r of parsed) {
        let siteId = siteIds.get(key(r.name));
        if (!siteId) {
          const { name, description, address, suite, city, state, postalCode, country } = r;
          [{ id: siteId }] = await tx
            .insert(sites)
            .values({ orgId: actor.orgId, name, description, address, suite, city, state, postalCode, country })
            .returning({ id: sites.id });
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
    template: "name,parent,tag_prefix\r\nIT equipment,,IT\r\nLaptops,IT equipment,LAP\r\n",
    notes: [
      "“parent” makes it a sub-category and is created if missing. One level only. Ones already on file are skipped.",
      "“tag_prefix” (up to 8 letters or digits) starts new asset tags in that category, e.g. LAP-000001.",
    ],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { name: "name", category: "name", parent: "parent", parentcategory: "parent", tagprefix: "tagPrefix", prefix: "tagPrefix" });
      const parsed = parseAll(
        rows,
        lines,
        z.object({
          name: reqText("Name"),
          parent: optText,
          // Same rule as Setup → Categories.
          tagPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,8}$/, "Tag prefix: up to 8 capital letters or digits").optional().transform((v) => v || null),
        }),
      );
      const all = await tx.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories);
      const byName = new Map(all.map((c) => [key(c.name), c]));
      let imported = 0;
      const ensure = async (name: string, parentId: string | null, tagPrefix: string | null = null) => {
        const had = byName.get(key(name));
        if (had) return had;
        const [c] = await tx.insert(categories).values({ orgId: actor.orgId, name, parentId, tagPrefix }).returning({ id: categories.id, name: categories.name, parentId: categories.parentId });
        byName.set(key(name), c);
        imported++;
        return c;
      };
      const errors: string[] = [];
      for (const [i, r] of parsed.entries()) {
        const p = r.parent ? await ensure(r.parent, null) : null;
        if (p?.parentId) errors.push(`Row ${lines[i]}: “${r.parent}” is already a sub-category.`);
        else await ensure(r.name, p?.id ?? null, r.tagPrefix);
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
    template: "tag,name,ends,length_months,notes\r\nTN-000001,Dell ProSupport,2028-03-31,,\r\n",
    notes: [
      "“tag” finds the asset and “name” is the provider; both are required.",
      "Give “ends” (the end date) or “length_months”, counted from the asset's purchase date.",
    ],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, {
        tag: "tag", assettag: "tag", name: "name", provider: "name", ends: "ends", expires: "ends", enddate: "ends",
        lengthmonths: "lengthMonths", months: "lengthMonths", length: "lengthMonths", notes: "notes",
      });
      const parsed = parseAll(
        rows.map((r) => ({ ...r, ends: normDate(r.ends) })),
        lines,
        z.object({
          tag: reqText("Tag"),
          name: reqText("Provider"),
          ends: optDate,
          lengthMonths: z.union([z.literal(""), z.coerce.number("Length must be a number of months").int().min(1).max(600)]).optional().transform((v) => v || null),
          notes: optText,
        }),
      );
      const found = await assetsByTag(tx, parsed.map((r) => r.tag), lines);
      // Same rule as the asset page: an end date, or a length counted from the purchase date.
      const errors = parsed.flatMap((r, i) => {
        if (r.ends) return [];
        if (!r.lengthMonths) return [`Row ${lines[i]}: give “ends” or “length_months”.`];
        return found.get(r.tag.toUpperCase())!.purchaseDate ? [] : [`Row ${lines[i]}: ${r.tag} has no purchase date to count “length_months” from; give “ends” instead.`];
      });
      if (errors.length) fail(errors);
      for (const r of parsed) {
        const asset = found.get(r.tag.toUpperCase())!;
        const expiresOn = r.ends ?? addMonths(asset.purchaseDate!, r.lengthMonths!);
        const [w] = await tx
          .insert(warranties)
          .values({ orgId: actor.orgId, assetId: asset.id, provider: r.name, expiresOn, lengthMonths: r.lengthMonths, notes: r.notes, createdBy: actor.name })
          .returning();
        await recordEvent(tx, actor, asset.id, "warranty_added", { warrantyId: w.id, provider: w.provider, expiresOn: w.expiresOn, notes: w.notes }, { source: "import" });
      }
      return { imported: parsed.length, skipped: 0, ignored };
    },
  },
  maintenance: {
    title: "Maintenance schedule",
    needs: "maintenance",
    template: "tag,name,type,due,repeat_months,vendor,notes\r\nTN-000001,Annual service,preventive,2027-01-15,12,HP Care,\r\n",
    notes: [
      "“tag” finds the asset, “name” is the job. “type” is preventive or repair (preventive if blank).",
      "“repeat_months” schedules the next one that many months after each is done; it needs a “due” date.",
    ],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, {
        tag: "tag", assettag: "tag", name: "name", job: "name", title: "name", type: "kind", kind: "kind", due: "dueDate", duedate: "dueDate",
        repeatmonths: "repeatMonths", repeat: "repeatMonths", everymonths: "repeatMonths", vendor: "vendor", notes: "notes",
      });
      const parsed = parseAll(
        rows.map((r) => ({ ...r, dueDate: normDate(r.dueDate), kind: r.kind?.toLowerCase() || "preventive" })),
        lines,
        z
          .object({
            tag: reqText("Tag"),
            name: reqText("Job"),
            kind: z.enum(MAINTENANCE_KINDS, "Type must be preventive or repair"),
            dueDate: optDate,
            repeatMonths: z.union([z.literal(""), z.coerce.number("Repeat must be a number of months").int().min(0).max(60, "Repeat at most every 60 months")]).optional().transform((v) => v || null),
            vendor: optText,
            notes: optText,
          })
          .refine((r) => !r.repeatMonths || r.dueDate, "A repeating schedule needs a due date to count from"),
      );
      const found = await assetsByTag(tx, parsed.map((r) => r.tag), lines);
      for (const r of parsed) {
        const asset = found.get(r.tag.toUpperCase())!;
        const [job] = await tx
          .insert(maintenance)
          .values({ orgId: actor.orgId, assetId: asset.id, title: r.name, kind: r.kind, dueDate: r.dueDate, repeatMonths: r.repeatMonths, vendor: r.vendor, notes: r.notes, createdBy: actor.name })
          .returning();
        await recordEvent(
          tx,
          actor,
          asset.id,
          "maintenance_scheduled",
          { maintenanceId: job.id, title: job.title, kind: job.kind, dueDate: job.dueDate, repeatMonths: job.repeatMonths, vendor: job.vendor },
          { source: "import" },
        );
      }
      return { imported: parsed.length, skipped: 0, ignored };
    },
  },
  inventory: {
    title: "Inventory items",
    needs: "inventory",
    template: "name,sku,unit,quantity,alert_level,unit_cost,site,location,notes\r\nHP 680 toner,TN-680,pcs,12,3,1450,Head Office,Store Room,\r\n",
    notes: [
      "Only “name” is required. “quantity” becomes the opening stock. Items with a name already on file are skipped.",
      "“location” must already exist under Setup; add “site” when two sites have a location with that name.",
    ],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, { name: "name", item: "name", sku: "sku", code: "sku", unit: "unit", quantity: "quantity", qty: "quantity", stock: "quantity", alertlevel: "minQuantity", minquantity: "minQuantity", unitcost: "unitCost", cost: "unitCost", site: "site", location: "location", notes: "notes" });
      const parsed = parseAll(
        rows.map((r) => ({ ...r, quantity: plainMoney(r.quantity), minQuantity: plainMoney(r.minQuantity), unitCost: plainMoney(r.unitCost) })),
        lines,
        z.object({ name: reqText("Name"), sku: optText, unit: optText, quantity: money, minQuantity: money, unitCost: money, site: optText, location: optText, notes: optText }),
      );
      const locs = await tx.select({ id: locations.id, name: locations.name, site: sites.name }).from(locations).innerJoin(sites, eq(sites.id, locations.siteId));
      const errors: string[] = [];
      const locationIds = parsed.map((r, i) => {
        if (!r.location) return null;
        const matches = locs.filter((l) => key(l.name) === key(r.location!) && (!r.site || key(l.site) === key(r.site)));
        if (matches.length === 1) return matches[0].id;
        errors.push(
          matches.length === 0
            ? `Row ${lines[i]}: location “${r.location}”${r.site ? ` at ${r.site}` : ""} doesn't exist. Add it under Setup first.`
            : `Row ${lines[i]}: more than one site has a location “${r.location}”; add a site column.`,
        );
        return null;
      });
      if (errors.length) fail(errors);
      const seen = new Set((await tx.select({ n: inventoryItems.name }).from(inventoryItems).where(isNull(inventoryItems.archivedAt))).map((i) => key(i.n)));
      let imported = 0;
      for (const [i, r] of parsed.entries()) {
        if (seen.has(key(r.name))) continue;
        seen.add(key(r.name));
        const [item] = await tx
          .insert(inventoryItems)
          .values({ orgId: actor.orgId, name: r.name, sku: r.sku, unit: r.unit ?? "pcs", minQuantity: r.minQuantity, unitCost: r.unitCost, locationId: locationIds[i], notes: r.notes })
          .returning();
        if (Number(r.quantity) > 0) await moveStock(tx, actor, { itemId: item.id, kind: "received", quantity: Number(r.quantity), note: "Imported opening stock" });
        imported++;
      }
      return { imported, skipped: parsed.length - imported, ignored };
    },
  },
  subscriptions: {
    title: "Software subscriptions",
    needs: "records",
    template:
      "name,vendor,plan,amount,currency,every,next_recharge,auto_renew,seats,owner,remind_days,notes\r\n" +
      "Microsoft 365,Microsoft,Business Standard,12500,INR,yearly,2027-03-31,no,25,,15,\r\n" +
      "Zoom,Zoom,Pro,15.99,USD,monthly,2026-12-05,yes,,,7,\r\n",
    notes: [
      "“name”, “amount”, “every” and “next_recharge” are required. Each gets a SUB tag automatically.",
      "“every” is monthly, quarterly, half-yearly, yearly or a number of months. “currency” defaults to yours.",
      "“owner” is a person's email or name, already under People. Subscriptions whose name is already on file are skipped.",
    ],
    run: async (tx, actor, text) => {
      const { rows, ignored, lines } = readRows(text, {
        name: "name", software: "name", vendor: "vendor", plan: "plan", amount: "amount", billing: "amount", billingamount: "amount", cost: "amount",
        currency: "currency", every: "every", period: "every", billingperiod: "every", everymonths: "every",
        nextrecharge: "nextDueOn", nextdue: "nextDueOn", duedate: "nextDueOn", renewaldate: "nextDueOn",
        autorenew: "autoRenew", seats: "seats", licences: "seats", licenses: "seats", owner: "owner", reminddays: "remindDays", notes: "notes",
      });
      const [org] = await tx.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, actor.orgId));
      const whole = (what: string, min: number, max: number) =>
        z.union([z.literal(""), z.coerce.number(`${what} must be a whole number`).int(`${what} must be a whole number`).min(min).max(max, `${what} can be at most ${max}`)]).optional().transform((v) => (v === "" || v === undefined ? null : v));
      const parsed = parseAll(
        rows.map((r) => ({
          ...r,
          amount: plainMoney(r.amount),
          currency: r.currency?.trim() || org.currency,
          every: String(PERIOD_WORDS[(r.every ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? r.every ?? ""),
          nextDueOn: normDate(r.nextDueOn),
        })),
        lines,
        z.object({
          name: reqText("Name"),
          vendor: optText,
          plan: optText,
          amount: z.string("Amount is required").regex(/^\d{1,10}(\.\d{1,2})?$/, "Amount must be a number like 12500 or 19.99"),
          currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code like INR or USD"),
          every: z.coerce
            .number("“every” must be monthly, quarterly, half-yearly, yearly or a number of months")
            .int("“every” must be a whole number of months")
            .min(1, "“every” must be monthly, quarterly, half-yearly, yearly or a number of months")
            .max(60, "“every” can be at most 60 months"),
          nextDueOn: z.iso.date("next_recharge must be a date like 2027-03-31"),
          autoRenew: z.string().optional().transform((v) => /^(y|yes|true|1|auto)$/i.test(v?.trim() ?? "")),
          seats: whole("Seats", 1, 100000),
          owner: optText,
          remindDays: whole("Remind days", 0, 90),
          notes: optText,
        }),
      );
      const people = await tx.select({ id: persons.id, name: persons.name, email: persons.email }).from(persons).where(isNull(persons.deletedAt));
      const errors: string[] = [];
      const ownerIds = parsed.map((r, i) => {
        if (!r.owner) return null;
        const matches = people.filter((p) => key(p.email ?? "") === key(r.owner!) || key(p.name) === key(r.owner!));
        if (matches.length === 1) return matches[0].id;
        errors.push(`Row ${lines[i]}: ${matches.length ? `more than one person is called “${r.owner}”; use their email` : `no one under People matches “${r.owner}”`}.`);
        return null;
      });
      if (errors.length) fail(errors);
      const seen = new Set((await tx.select({ n: subscriptions.name }).from(subscriptions)).map((s) => key(s.n)));
      let imported = 0;
      for (const [i, r] of parsed.entries()) {
        if (seen.has(key(r.name))) continue;
        seen.add(key(r.name));
        await tx.insert(subscriptions).values({
          orgId: actor.orgId,
          tag: await nextSubscriptionTag(tx, actor.orgId),
          name: r.name, vendor: r.vendor, plan: r.plan, amount: r.amount, currency: r.currency, periodMonths: r.every, nextDueOn: r.nextDueOn,
          autoRenew: r.autoRenew, seats: r.seats, ownerId: ownerIds[i], remindDays: r.remindDays ?? 7, notes: r.notes, createdBy: actor.name,
        });
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
