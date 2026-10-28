# TrackNest

Asset tracking for organizations: register assets, print QR labels, check assets out and in, and keep a permanent custody history. See the PRD for the full plan.

## Stack

Next.js 16 (UI + server actions) · PostgreSQL 16 · Drizzle ORM · Zod · Tailwind CSS · bwip-js (QR) · Vitest.

## Run locally

Needs Node 22+, pnpm and PostgreSQL 16 running on `localhost:5432`.

```bash
pnpm install
cp .env.example .env
pnpm db:setup        # creates tracknest + tracknest_test, runs migrations, enables the app role
pnpm dev             # http://localhost:3000
pnpm test            # custody-history and tenant-isolation tests
```

Local demo account (created through the sign-up page; dev only):
`admin@demo.test` / `tracknest-demo-2026`

## How data is protected

- **Tenant isolation:** every tenant table has `org_id` and Postgres Row-Level Security. The app connects as `tracknest_app` (not the table owner) and every query runs inside `withOrg()` (`src/db/index.ts`), which sets `app.org_id` for that transaction.
- **Custody history can't be changed:** `asset_events` is insert-only for the app role, and triggers block UPDATE/DELETE even for the owner. A `checkouts` row can be closed once and is then read-only (`drizzle/0001_security.sql`).
- **One open check-out per asset:** a partial unique index plus a row lock in `src/lib/custody.ts`.

## Layout

- `src/db/schema.ts` — tables
- `drizzle/` — migrations (`0001_security.sql` = RLS, grants, history triggers)
- `src/lib/custody.ts` — check-out, check-in, extend due (shared by web and future API)
- `src/app/(app)/` — dashboard, assets, scan, history (+ CSV export), people, setup
