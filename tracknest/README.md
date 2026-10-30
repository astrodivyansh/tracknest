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

Local demo accounts (dev only), both with password `tracknest-demo-2026`:
`admin@demo.test` (owner, created through sign-up) and `ravi@demo.test` (manager, joined through an invite link).

**Building while `pnpm dev` runs:** use `NEXT_DIST_DIR=.next-build pnpm build` so the build doesn't share `.next` with the dev server. If pages ever keep reloading in `pnpm dev`, a build wrote into `.next`: stop the dev server, delete `.next`, and start it again.

## Deploying

One VPS with Docker Compose: PostgreSQL, the app, Caddy for HTTPS, an hourly alert job and daily backups. Step by step, including restoring a backup: [DEPLOY.md](DEPLOY.md).

## API

REST API at `/api/v1` for other systems (HR, ERP, helpdesk). The contract is [openapi.yaml](openapi.yaml): open it in Postman, Swagger Editor or any OpenAPI tool. Admins create keys under **More → Team and invites → API keys**: read-only or read and write, shown once, revocable. Changes made through the API follow the same rules as the web app and appear in history as "API key: name".

```bash
curl -H "Authorization: Bearer $TRACKNEST_KEY" https://YOUR_DOMAIN/api/v1/assets/TN-000042
curl -X POST -H "Authorization: Bearer $TRACKNEST_KEY" -H "Content-Type: application/json" \
  -d '{"holder":{"type":"person","id":"<person id from GET /people>"},"dueDate":"2026-12-31"}' \
  https://YOUR_DOMAIN/api/v1/assets/TN-000042/checkout
```

`src/lib/api.test.ts` exercises every endpoint against a test database.

## Email alerts

Once a day per organization (first run after 8 AM in its timezone):

- the person holding an asset gets a reminder on the due date, then an overdue notice (repeated weekly);
- managers, admins and the owner get one summary of overdue returns, items due today and maintenance due within 7 days. Admins turn this on or off per person on the Team page.

Invites are emailed too. Set `SMTP_URL`, `MAIL_FROM` and `APP_URL` in `.env`. Without `SMTP_URL`, emails are printed to the server log.

Run the job hourly with cron. It never sends the same email twice (`alert_log`), so extra runs are harmless:

```
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR_APP_URL/api/cron/alerts
```

## Photos and documents

Uploaded files are stored on disk under `UPLOAD_DIR` (default `.data/uploads`, git-ignored). In production put it on a volume that is backed up together with the database. Only JPEG, PNG, WebP and PDF up to 10 MB are accepted; the type is detected from the file's bytes, and files are only served to signed-in members of the same organization.

## How data is protected

- **Tenant isolation:** every tenant table has `org_id` and Postgres Row-Level Security. The app connects as `tracknest_app` (not the table owner) and every query runs inside `withOrg()` (`src/db/index.ts`), which sets `app.org_id` for that transaction.
- **Custody history can't be changed:** `asset_events` is insert-only for the app role, and triggers block UPDATE/DELETE even for the owner. A `checkouts` row can be closed once and is then read-only (`drizzle/0001_security.sql`).
- **One open check-out per asset:** a partial unique index plus a row lock in `src/lib/custody.ts`.
- **Sign-in rate limiting:** 5 failed attempts per email or 30 per IP in 15 minutes blocks further tries (`login_failures` table). The IP comes from `X-Forwarded-For`, so run behind the reverse proxy.
- **Invites:** admins create a one-time link (valid 7 days, only its hash is stored) on the Team page. There's no email sending yet, so the admin sends the link themselves.

## Layout

- `src/db/schema.ts` — tables
- `drizzle/` — migrations (`0001_security.sql` = RLS, grants, history triggers)
- `src/lib/custody.ts` — check-out, check-in, extend due (shared by web and future API)
- `src/lib/import.ts` — CSV import of assets and people (all-or-nothing, with row-numbered errors)
- `src/app/(app)/` — dashboard, assets, scan, history (+ CSV export), people, labels (print/PDF), import, team, setup
