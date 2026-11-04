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
  boolean,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/** Per standard field; a field with no entry is shown, optional, in its usual place. */
export type AssetFormSetup = Record<string, { hidden?: boolean; required?: boolean; label?: string; position?: number }>;

export const DATE_FORMATS = ["medium", "dmy", "mdy", "iso"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

// ---- Global tables (no RLS; only auth code touches them) ----

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  tagPrefix: text("tag_prefix").notNull().default("TN"),
  nextTagSeq: integer("next_tag_seq").notNull().default(1),
  alertSettings: jsonb("alert_settings").$type<Partial<AlertSettings>>().notNull().default({}), // see lib/alerts.ts
  dateFormat: text("date_format", { enum: DATE_FORMATS }).notNull().default("medium"),
  fyStartMonth: integer("fy_start_month").notNull().default(4), // 4 = April–March
  logoKey: text("logo_key"), // storage key (lib/storage.ts)
  disabledFeatures: jsonb("disabled_features").$type<string[]>().notNull().default([]), // lib/permissions.ts ACTIONS
  assetForm: jsonb("asset_form").$type<AssetFormSetup>().notNull().default({}), // lib/asset-form-setup.ts
  setupStep: integer("setup_step").notNull().default(1), // furthest wizard step reached; past the last = finished (lib/wizard.ts)
  createdAt: createdAt(),
});


export type AlertSettings = {
  holderReminders: boolean; // "due today" and weekly "overdue" emails to the holder
  maintenanceDays: number; // digest lists maintenance due this many days ahead
  warrantyDays: number; // digest lists warranties expiring this many days ahead
};

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
    emailAlerts: boolean("email_alerts").notNull().default(true), // daily digest for managers and up
    dashboard: jsonb("dashboard").$type<string[]>(), // widgets in order (lib/dashboard-widgets.ts); null = all
    groupId: uuid("group_id"), // security group (lib/permissions.ts); null = everything the role allows
    totpSecret: text("totp_secret"), // base32; set while setting up two-step sign-in
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpLastStep: integer("totp_last_step"), // last accepted 30-second step, so a code can't be replayed
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

// Keys for the REST API (/api/v1). Looked up by hash before the org is known, so global like sessions.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(), // also used as the actor id in history
    orgId: orgId(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(), // sha256 of the key; the key itself is shown once
    prefix: text("prefix").notNull(), // first characters, to recognise a key in the list
    scope: text("scope", { enum: ["read", "write"] }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)],
);

// One-time password reset links; only the token's hash is stored.
export const passwordResets = pgTable(
  "password_resets",
  {
    id: text("id").primaryKey(), // sha256 of the token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId, t.createdAt)],
);

// Failed sign-ins, for rate limiting. Rows older than the window are pruned on write.
export const loginFailures = pgTable(
  "login_failures",
  {
    id: id(),
    email: text("email").notNull(),
    ip: text("ip").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_failures_email_idx").on(t.email, t.at), index("login_failures_ip_idx").on(t.ip, t.at)],
);

// Read before sign-in (by token), so it's a global table like users.
export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(), // sha256 of the invite token
    orgId: orgId(),
    email: text("email").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    invitedBy: text("invited_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invites_org_idx").on(t.orgId)],
);

// ---- Tenant tables (RLS on org_id, see drizzle/*_security.sql) ----

export const sites = pgTable("sites", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  description: text("description"),
  address: text("address"),
  suite: text("suite"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country"),
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

export const DEP_METHODS = ["none", "straight_line", "declining", "double_declining", "sum_of_years"] as const;
export type DepMethod = (typeof DEP_METHODS)[number];

export const categories = pgTable("categories", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id), // one level of sub-categories
  tagPrefix: text("tag_prefix"), // new asset tags, e.g. DESK-000001; empty = from the name (lib/custody.ts nextTags)
  // Depreciation rule for every asset in the category (see lib/depreciation.ts).
  depMethod: text("dep_method", { enum: DEP_METHODS }).notNull().default("none"),
  depLifeYears: numeric("dep_life_years", { precision: 5, scale: 2 }), // straight-line
  depRatePct: numeric("dep_rate_pct", { precision: 5, scale: 2 }), // declining balance, per year
  depSalvagePct: numeric("dep_salvage_pct", { precision: 5, scale: 2 }), // residual value, % of cost
  createdAt: createdAt(),
});

export const departments = pgTable("departments", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const WORK_LOCATIONS = ["office", "home"] as const;
export const WORK_LOCATION_LABEL = { office: "Work from office", home: "Work from home" } as const;

export const persons = pgTable("persons", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  email: text("email"),
  employeeId: text("employee_id"),
  departmentId: uuid("department_id").references(() => departments.id),
  brand: text("brand"), // the group company they belong to
  designation: text("designation"),
  workLocation: text("work_location", { enum: WORK_LOCATIONS }),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// Outside parties assets are leased to (a lease is a check-out to a customer).
export const customers = pgTable("customers", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
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

export const HOLDER_TYPES = ["person", "location", "department", "customer"] as const;
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
    purchasedFrom: text("purchased_from"),
    // Linked parent (e.g. a laptop's dock belongs to the laptop); one level, see lib/custody.ts linkAsset.
    parentId: uuid("parent_id").references((): AnyPgColumn => assets.id),
    siteId: uuid("site_id").references(() => sites.id),
    locationId: uuid("location_id").references(() => locations.id),
    departmentId: uuid("department_id").references(() => departments.id),
    status: text("status", { enum: ASSET_STATUSES }).notNull().default("available"),
    condition: text("condition"),
    notes: text("notes"),
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    // Set when status becomes "disposed" (lib/custody.ts changeStatus).
    disposedOn: date("disposed_on"),
    disposalMethod: text("disposal_method", { enum: ["sold", "scrapped", "donated", "written_off"] }),
    disposalValue: numeric("disposal_value", { precision: 12, scale: 2 }), // sale or scrap proceeds
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
    index("assets_parent_idx").on(t.parentId),
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
  "moved",
  "linked",
  "unlinked",
  "maintenance_scheduled",
  "maintenance_started",
  "maintenance_completed",
  "maintenance_cancelled",
  "archived",
  "audited",
  "reserved",
  "reservation_cancelled",
  "file_added",
  "file_removed",
  "warranty_added",
  "warranty_removed",
  "record_linked",
  "record_unlinked",
  "custom",
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
    // clock_timestamp, not now(): events written in one transaction must keep their order.
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    index("asset_events_asset_idx").on(t.assetId, t.occurredAt),
    index("asset_events_org_time_idx").on(t.orgId, t.occurredAt),
  ],
);

export const MAINTENANCE_KINDS = ["preventive", "repair"] as const;
export const MAINTENANCE_STATES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export type MaintenanceState = (typeof MAINTENANCE_STATES)[number];

// Never deleted (cancel instead), so maintenance cost history stays complete.
export const maintenance = pgTable(
  "maintenance",
  {
    id: id(),
    orgId: orgId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    title: text("title").notNull(),
    kind: text("kind", { enum: MAINTENANCE_KINDS }).notNull(),
    state: text("state", { enum: MAINTENANCE_STATES }).notNull().default("scheduled"),
    dueDate: date("due_date"),
    repeatMonths: integer("repeat_months"), // preventive schedule; the next one is created on completion
    vendor: text("vendor"),
    notes: text("notes"),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    completionNotes: text("completion_notes"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
  },
  (t) => [
    index("maintenance_org_state_idx").on(t.orgId, t.state, t.dueDate),
    index("maintenance_asset_idx").on(t.assetId),
    // An asset is in the workshop at most once at a time.
    uniqueIndex("maintenance_one_active_uq").on(t.assetId).where(sql`state = 'in_progress'`),
  ],
);

// One row per email sent by the alert job; the unique key stops a re-run from sending twice.
export const alertLog = pgTable(
  "alert_log",
  {
    id: id(),
    orgId: orgId(),
    key: text("key").notNull(), // e.g. "digest:2026-10-29:user@x.com"
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("alert_log_key_uq").on(t.orgId, t.key)],
);

export const audits = pgTable("audits", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  // Scope: a location, else a site, else everything.
  siteId: uuid("site_id").references(() => sites.id),
  locationId: uuid("location_id").references(() => locations.id),
  categoryId: uuid("category_id").references(() => categories.id), // and its sub-categories
  byList: boolean("by_list").notNull().default(false), // expected = a pasted list of tags, not a place
  state: text("state", { enum: ["open", "closed"] }).notNull().default("open"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: text("closed_by"),
});

export const AUDIT_RESULTS = ["found", "missing"] as const;

// expected = in the snapshot taken when the audit started; unexpected scans are added with expected = false.
export const auditItems = pgTable(
  "audit_items",
  {
    id: id(),
    orgId: orgId(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    expected: boolean("expected").notNull(),
    expectedLocationId: uuid("expected_location_id").references(() => locations.id),
    result: text("result", { enum: AUDIT_RESULTS }), // null until scanned, or until close marks it missing
    foundLocationId: uuid("found_location_id").references(() => locations.id),
    foundAt: timestamp("found_at", { withTimezone: true }),
    foundBy: text("found_by"),
  },
  (t) => [uniqueIndex("audit_items_asset_uq").on(t.auditId, t.assetId), index("audit_items_audit_idx").on(t.auditId, t.result)],
);

// Bookings for future dates (org calendar days, inclusive). Overlapping active bookings of one
// asset are refused by an exclusion constraint (drizzle/0009_reservations.sql).
export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    orgId: orgId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    holderType: text("holder_type", { enum: HOLDER_TYPES }).notNull(),
    holderId: uuid("holder_id").notNull(),
    holderName: text("holder_name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    notes: text("notes"),
    state: text("state", { enum: ["active", "fulfilled", "cancelled"] }).notNull().default("active"),
    checkoutId: uuid("checkout_id").references(() => checkouts.id), // set when fulfilled by a check-out
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("reservations_org_start_idx").on(t.orgId, t.state, t.startDate), index("reservations_asset_idx").on(t.assetId)],
);

export const FILE_KINDS = ["photo", "document"] as const;

// Photos and documents attached to an asset; the bytes live in storage under `storageKey` (lib/storage.ts).
export const assetFiles = pgTable(
  "asset_files",
  {
    id: id(),
    orgId: orgId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    kind: text("kind", { enum: FILE_KINDS }).notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(), // detected from the bytes, never taken from the browser
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("asset_files_asset_idx").on(t.assetId, t.createdAt)],
);

export const FIELD_TYPES = ["text", "textarea", "number", "currency", "date", "select", "multiselect", "checkbox", "email", "url"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// Org-defined extra asset fields. Values live in assets.custom, keyed by field id (so renaming is safe).
export const customFields = pgTable(
  "custom_fields",
  {
    id: id(),
    orgId: orgId(),
    label: text("label").notNull(),
    type: text("type", { enum: FIELD_TYPES }).notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]), // for "select"
    required: boolean("required").notNull().default(false),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }), // null = every asset
    remindDays: integer("remind_days"), // date fields: list in the daily email this many days ahead
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_fields_label_uq").on(t.orgId, sql`lower(${t.label})`)],
);

export const warranties = pgTable(
  "warranties",
  {
    id: id(),
    orgId: orgId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    provider: text("provider"),
    expiresOn: date("expires_on").notNull(),
    lengthMonths: integer("length_months"),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("warranties_asset_idx").on(t.assetId), index("warranties_org_expiry_idx").on(t.orgId, t.expiresOn)],
);

// Per-event emails (lib/event-mail.ts). No row = the built-in default, which is off.
export const emailTemplates = pgTable(
  "email_templates",
  {
    id: id(),
    orgId: orgId(),
    event: text("event", { enum: EVENT_TYPES }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    toHolder: boolean("to_holder").notNull().default(true),
    toManagers: boolean("to_managers").notNull().default(false),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), // events before this aren't emailed
  },
  (t) => [uniqueIndex("email_templates_event_uq").on(t.orgId, t.event)],
);

export const REPORT_SCHEDULES = ["none", "daily", "weekly", "monthly"] as const;

// A report with its filters and columns (a query string), optionally emailed as CSV on a schedule.
export const savedReports = pgTable("saved_reports", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  params: text("params").notNull().default(""),
  schedule: text("schedule", { enum: REPORT_SCHEDULES }).notNull().default("none"),
  recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

// Narrows what its members may do (lib/permissions.ts). Their role still sets the ceiling.
export const securityGroups = pgTable("security_groups", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

// Org-defined events recorded on assets, e.g. "Calibrated" or "Safety inspection".
export const customEvents = pgTable("custom_events", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

// Consumable stock (toner, cables…): counted, not tracked one by one like assets.
export const inventoryItems = pgTable("inventory_items", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  sku: text("sku"),
  unit: text("unit").notNull().default("pcs"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("0"), // mirrors the latest move's balance
  minQuantity: numeric("min_quantity", { precision: 12, scale: 2 }), // alert at or below this
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  locationId: uuid("location_id").references(() => locations.id),
  notes: text("notes"),
  createdAt: createdAt(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const STOCK_MOVES = ["received", "issued", "counted"] as const;

// Permanent, like custody history: the app role can't update or delete these (see the migration).
export const inventoryMoves = pgTable(
  "inventory_moves",
  {
    id: id(),
    orgId: orgId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    kind: text("kind", { enum: STOCK_MOVES }).notNull(),
    change: numeric("change", { precision: 12, scale: 2 }).notNull(), // signed
    balance: numeric("balance", { precision: 12, scale: 2 }).notNull(),
    note: text("note"), // who it was issued to, the supplier, why the count differed
    actorName: text("actor_name").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [index("inventory_moves_item_idx").on(t.itemId, t.occurredAt)],
);

export const RECORD_KINDS = ["contract", "insurance", "funding"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

// Contracts and licences, insurance policies and funding sources; each can cover many assets.
export const assetRecords = pgTable(
  "asset_records",
  {
    id: id(),
    orgId: orgId(),
    kind: text("kind", { enum: RECORD_KINDS }).notNull(),
    name: text("name").notNull(),
    reference: text("reference"), // contract, policy or grant number
    vendor: text("vendor"), // supplier, insurer or funder
    startDate: date("start_date"),
    endDate: date("end_date"),
    amount: numeric("amount", { precision: 12, scale: 2 }), // contract value, premium or funds available
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("asset_records_org_idx").on(t.orgId, t.kind)],
);

export const assetRecordLinks = pgTable(
  "asset_record_links",
  {
    id: id(),
    orgId: orgId(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => assetRecords.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("asset_record_links_uq").on(t.recordId, t.assetId), index("asset_record_links_asset_idx").on(t.assetId)],
);
