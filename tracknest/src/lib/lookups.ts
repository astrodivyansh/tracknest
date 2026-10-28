import { asc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, departments, locations, persons, sites } from "@/db/schema";

/** Dropdown data for asset and check-out forms. */
export async function getLookups(tx: Tx) {
  const [cats, locs, depts, people, siteRows] = await Promise.all([
    tx.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
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
  ]);
  return { categories: cats, locations: locs, departments: depts, persons: people, sites: siteRows };
}
export type Lookups = Awaited<ReturnType<typeof getLookups>>;
