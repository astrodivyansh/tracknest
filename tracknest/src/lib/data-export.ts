import { asc, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db";
import {
  assetRecordLinks,
  assetRecords,
  assets,
  categories,
  checkouts,
  customers,
  departments,
  inventoryItems,
  inventoryMoves,
  locations,
  maintenance,
  persons,
  reservations,
  sites,
  subscriptionLinks,
  subscriptionPayments,
  subscriptions,
  warranties,
  type RecordKind,
} from "@/db/schema";

const MAX_ROWS = 100_000;
type Table = { label: string; header: string[]; rows: (tx: Tx) => Promise<unknown[][]> };

const parent = alias(categories, "parent");

const records = (kind: RecordKind, label: string): Table => ({
  label,
  header: ["Name", "Reference", "Vendor", "Starts", "Ends", "Amount", "Notes", "Asset tags"],
  rows: async (tx) => {
    const rows = await tx.select().from(assetRecords).where(eq(assetRecords.kind, kind)).orderBy(asc(assetRecords.name)).limit(MAX_ROWS);
    const links = await tx.select({ recordId: assetRecordLinks.recordId, tag: assets.tag }).from(assetRecordLinks).innerJoin(assets, eq(assets.id, assetRecordLinks.assetId));
    return rows.map((r) => [r.name, r.reference, r.vendor, r.startDate, r.endDate, r.amount, r.notes, links.filter((l) => l.recordId === r.id).map((l) => l.tag).join(" ")]);
  },
});

/** Everything an org can download from Tools → Import and export. The asset list and history have their own exports. */
export const EXPORTS: Record<string, Table> = {
  people: {
    label: "People",
    header: ["Name", "Email", "Employee ID", "Department"],
    rows: async (tx) =>
      (
        await tx
          .select({ n: persons.name, e: persons.email, id: persons.employeeId, d: departments.name })
          .from(persons)
          .leftJoin(departments, eq(departments.id, persons.departmentId))
          .where(isNull(persons.deletedAt))
          .orderBy(asc(persons.name))
          .limit(MAX_ROWS)
      ).map((r) => [r.n, r.e, r.id, r.d]),
  },
  customers: {
    label: "Customers",
    header: ["Name", "Company", "Email", "Phone", "Address", "Notes"],
    rows: async (tx) =>
      (await tx.select().from(customers).where(isNull(customers.deletedAt)).orderBy(asc(customers.name)).limit(MAX_ROWS)).map((c) => [c.name, c.company, c.email, c.phone, c.address, c.notes]),
  },
  sites: {
    label: "Sites and locations",
    header: ["Site", "Address", "Location"],
    rows: async (tx) =>
      (
        await tx
          .select({ s: sites.name, a: sites.address, l: locations.name })
          .from(sites)
          .leftJoin(locations, eq(locations.siteId, sites.id))
          .orderBy(asc(sites.name), asc(locations.name))
          .limit(MAX_ROWS)
      ).map((r) => [r.s, r.a, r.l]),
  },
  categories: {
    label: "Categories",
    header: ["Name", "Parent category"],
    rows: async (tx) =>
      (await tx.select({ n: categories.name, p: parent.name }).from(categories).leftJoin(parent, eq(parent.id, categories.parentId)).orderBy(asc(categories.name)).limit(MAX_ROWS)).map((r) => [r.n, r.p]),
  },
  departments: {
    label: "Departments",
    header: ["Name"],
    rows: async (tx) => (await tx.select({ n: departments.name }).from(departments).orderBy(asc(departments.name)).limit(MAX_ROWS)).map((r) => [r.n]),
  },
  warranties: {
    label: "Warranties",
    header: ["Tag", "Asset", "Provider", "Ends", "Length (months)", "Notes"],
    rows: async (tx) =>
      (
        await tx
          .select({ t: assets.tag, n: assets.name, w: warranties })
          .from(warranties)
          .innerJoin(assets, eq(assets.id, warranties.assetId))
          .orderBy(asc(warranties.expiresOn))
          .limit(MAX_ROWS)
      ).map((r) => [r.t, r.n, r.w.provider, r.w.expiresOn, r.w.lengthMonths, r.w.notes]),
  },
  maintenance: {
    label: "Maintenance",
    header: ["Tag", "Asset", "Job", "Type", "State", "Due", "Vendor", "Cost", "Notes"],
    rows: async (tx) =>
      (
        await tx
          .select({ t: assets.tag, n: assets.name, m: maintenance })
          .from(maintenance)
          .innerJoin(assets, eq(assets.id, maintenance.assetId))
          .orderBy(desc(maintenance.createdAt))
          .limit(MAX_ROWS)
      ).map((r) => [r.t, r.n, r.m.title, r.m.kind, r.m.state, r.m.dueDate, r.m.vendor, r.m.cost, r.m.notes]),
  },
  reservations: {
    label: "Reservations",
    header: ["Tag", "Asset", "For", "From", "To", "State", "Notes"],
    rows: async (tx) =>
      (
        await tx
          .select({ t: assets.tag, n: assets.name, r: reservations })
          .from(reservations)
          .innerJoin(assets, eq(assets.id, reservations.assetId))
          .orderBy(desc(reservations.startDate))
          .limit(MAX_ROWS)
      ).map((r) => [r.t, r.n, r.r.holderName, r.r.startDate, r.r.endDate, r.r.state, r.r.notes]),
  },
  checkouts: {
    label: "Check-outs and leases",
    header: ["Tag", "Asset", "Held by", "Holder type", "Out", "Due", "Returned", "State"],
    rows: async (tx) =>
      (
        await tx
          .select({ t: assets.tag, n: assets.name, c: checkouts })
          .from(checkouts)
          .innerJoin(assets, eq(assets.id, checkouts.assetId))
          .orderBy(desc(checkouts.checkedOutAt))
          .limit(MAX_ROWS)
      ).map((r) => [r.t, r.n, r.c.holderName, r.c.holderType, r.c.checkedOutAt.toISOString(), r.c.dueAt?.toISOString(), r.c.checkedInAt?.toISOString(), r.c.state]),
  },
  inventory: {
    label: "Inventory items",
    header: ["Name", "SKU", "Unit", "Quantity", "Alert level", "Unit cost", "Location", "Notes"],
    rows: async (tx) =>
      (
        await tx
          .select({ i: inventoryItems, l: locations.name })
          .from(inventoryItems)
          .leftJoin(locations, eq(locations.id, inventoryItems.locationId))
          .where(isNull(inventoryItems.archivedAt))
          .orderBy(asc(inventoryItems.name))
          .limit(MAX_ROWS)
      ).map((r) => [r.i.name, r.i.sku, r.i.unit, r.i.quantity, r.i.minQuantity, r.i.unitCost, r.l, r.i.notes]),
  },
  "inventory-moves": {
    label: "Inventory movements",
    header: ["When", "Item", "What", "Change", "Balance", "Note", "By"],
    rows: async (tx) =>
      (
        await tx
          .select({ m: inventoryMoves, n: inventoryItems.name })
          .from(inventoryMoves)
          .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMoves.itemId))
          .orderBy(desc(inventoryMoves.occurredAt))
          .limit(MAX_ROWS)
      ).map((r) => [r.m.occurredAt.toISOString(), r.n, r.m.kind, r.m.change, r.m.balance, r.m.note, r.m.actorName]),
  },
  contracts: records("contract", "Contracts and licences"),
  insurance: records("insurance", "Insurance"),
  funding: records("funding", "Funding"),
  subscriptions: {
    label: "Software subscriptions",
    // The first columns match the subscriptions import, so a file can go back in.
    header: ["Name", "Vendor", "Plan", "Amount", "Currency", "Every (months)", "Next recharge", "Auto-renew", "Seats", "Owner", "Remind days", "Notes", "Tag", "Status", "Linked assets", "Seat holders"],
    rows: async (tx) => {
      const rows = await tx.select({ s: subscriptions, owner: persons.name }).from(subscriptions).leftJoin(persons, eq(persons.id, subscriptions.ownerId)).orderBy(asc(subscriptions.name)).limit(MAX_ROWS);
      const links = await tx
        .select({ id: subscriptionLinks.subscriptionId, tag: assets.tag, person: persons.name })
        .from(subscriptionLinks)
        .leftJoin(assets, eq(assets.id, subscriptionLinks.assetId))
        .leftJoin(persons, eq(persons.id, subscriptionLinks.personId));
      return rows.map(({ s, owner }) => {
        const mine = links.filter((l) => l.id === s.id);
        return [
          s.name, s.vendor, s.plan, s.amount, s.currency, s.periodMonths, s.nextDueOn, s.autoRenew ? "yes" : "no", s.seats, owner, s.remindDays, s.notes,
          s.tag, s.state, mine.flatMap((l) => (l.tag ? [l.tag] : [])).join(" "), mine.flatMap((l) => (l.person ? [l.person] : [])).join("; "),
        ];
      });
    },
  },
  "subscription-payments": {
    label: "Software recharges",
    header: ["Paid on", "Tag", "Name", "Amount", "Currency", "Period from", "Period to", "Invoice no.", "Notes", "Recorded by"],
    rows: async (tx) =>
      (
        await tx
          .select({ p: subscriptionPayments, tag: subscriptions.tag, name: subscriptions.name })
          .from(subscriptionPayments)
          .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPayments.subscriptionId))
          .orderBy(desc(subscriptionPayments.paidOn))
          .limit(MAX_ROWS)
      ).map(({ p, tag, name }) => [p.paidOn, tag, name, p.amount, p.currency, p.periodFrom, p.periodTo, p.reference, p.notes, p.actorName]),
  },
};
