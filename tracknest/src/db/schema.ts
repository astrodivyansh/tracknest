import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  date,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

// ---- Global tables (no RLS; only auth code touches them) ----

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  tagPrefix: text("tag_prefix").notNull().default("TN"),
  nextTagSeq: integer("next_tag_seq").notNull().default(1),
  createdAt: createdAt(),
});

export const ROLES = ["viewer", "manager", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull().default("viewer"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---- Tenant tables (RLS on org_id, see drizzle/*_security.sql) ----

export const sites = pgTable("sites", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  address: text("address"),
  createdAt: createdAt(),
});

export const locations = pgTable("locations", {
  id: id(),
  orgId: orgId(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const categories = pgTable("categories", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const departments = pgTable("departments", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const persons = pgTable("persons", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  email: text("email"),
  employeeId: text("employee_id"),
  departmentId: uuid("department_id").references(() => departments.id),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const ASSET_STATUSES = [
  "available",
  "checked_out",
  "under_maintenance",
  "lost",
  "broken",
  "disposed",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const HOLDER_TYPES = ["person", "location", "department"] as const;
export type HolderType = (typeof HOLDER_TYPES)[number];

export const assets = pgTable(
  "assets",
  {
    id: id(),
    orgId: orgId(),
    tag: text("tag").notNull(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    brand: text("brand"),
    model: text("model"),
    serial: text("serial"),
    purchaseDate: date("purchase_date"),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    siteId: uuid("site_id").references(() => sites.id),
    locationId: uuid("location_id").references(() => locations.id),
    departmentId: uuid("department_id").references(() => departments.id),
    status: text("status", { enum: ASSET_STATUSES }).notNull().default("available"),
    condition: text("condition"),
    notes: text("notes"),
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    // Current holder, mirrored from the open checkout for fast list views.
    holderType: text("holder_type", { enum: HOLDER_TYPES }),
    holderId: uuid("holder_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("assets_org_tag_uq").on(t.orgId, t.tag),
    index("assets_org_status_idx").on(t.orgId, t.status),
  ],
);

export const checkouts = pgTable(
  "checkouts",
  {
    id: id(),
    orgId: orgId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    holderType: text("holder_type", { enum: HOLDER_TYPES }).notNull(),
    holderId: uuid("holder_id").notNull(),
    holderName: text("holder_name").notNull(), // snapshot: history stays readable if the holder is removed
    checkedOutBy: uuid("checked_out_by").notNull(),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    outCondition: text("out_condition"),
    outNotes: text("out_notes"),
    checkedInBy: uuid("checked_in_by"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    returnLocationId: uuid("return_location_id").references(() => locations.id),
    inCondition: text("in_condition"),
    inNotes: text("in_notes"),
    state: text("state", { enum: ["open", "returned"] }).notNull().default("open"),
  },
  (t) => [
    // At most one open checkout per asset, enforced by the database.
    uniqueIndex("checkouts_one_open_uq").on(t.assetId).where(sql`state = 'open'`),
    index("checkouts_holder_idx").on(t.orgId, t.holderType, t.holderId),
  ],
);

export const EVENT_TYPES = [
  "created",
  "edited",
  "checked_out",
  "checked_in",
  "due_extended",
  "status_changed",
  "correction",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const assetEvents = pgTable(
  "asset_events",
  {
    id: id(),
    orgId: orgId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    checkoutId: uuid("checkout_id").references(() => checkouts.id),
    actorId: uuid("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    source: text("source", { enum: ["web", "scanner", "api", "import"] }).notNull().default("web"),
    correctsEventId: uuid("corrects_event_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("asset_events_asset_idx").on(t.assetId, t.occurredAt),
    index("asset_events_org_time_idx").on(t.orgId, t.occurredAt),
  ],
);
