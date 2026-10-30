import { asc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, customers, customFields, departments, locations, organizations, persons, sites } from "@/db/schema";

/** Dropdown data for asset and check-out forms. */
export async function getLookups(tx: Tx) {
  const [cats, locs, depts, people, siteRows, fields, custs, org] = await Promise.all([
    tx.select({ id: categories.id, own: categories.name, parentId: categories.parentId }).from(categories).orderBy(asc(categories.name)),
    tx
      .select({ id: locations.id, name: locations.name, siteId: locations.siteId, siteName: sites.name })
      .from(locations)
      .innerJoin(sites, eq(sites.id, locations.siteId))
      .orderBy(asc(sites.name), asc(locations.name)),
    tx.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.name)),
    tx
      .select({ id: persons.id, name: persons.name, employeeId: persons.employeeId })
      .from(persons)
      .where(isNull(persons.deletedAt))
      .orderBy(asc(persons.name)),
    tx.select({ id: sites.id, name: sites.name }).from(sites).orderBy(asc(sites.name)),
    tx
      .select({
        id: customFields.id,
        label: customFields.label,
        type: customFields.type,
        options: customFields.options,
        required: customFields.required,
        categoryId: customFields.categoryId,
        remindDays: customFields.remindDays,
      })
      .from(customFields)
      .orderBy(asc(customFields.createdAt)),
    tx
      .select({ id: customers.id, name: customers.name, company: customers.company })
      .from(customers)
      .where(isNull(customers.deletedAt))
      .orderBy(asc(customers.name)),
    tx.select({ assetForm: organizations.assetForm }).from(organizations).where(eq(organizations.id, sql`current_setting('app.org_id')::uuid`)),
  ]);
  // Sub-categories show as "Parent › Child" and sort under their parent.
  const byId = new Map(cats.map((c) => [c.id, c]));
  const categoryList = cats
    .map((c) => ({ ...c, name: c.parentId ? `${byId.get(c.parentId)?.own} › ${c.own}` : c.own }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { categories: categoryList, locations: locs, departments: depts, persons: people, sites: siteRows, customFields: fields, customers: custs, assetForm: org[0]?.assetForm ?? {} };
}
export type Lookups = Awaited<ReturnType<typeof getLookups>>;
