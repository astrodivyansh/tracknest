#!/usr/bin/env bash
# One-time local setup: create the database, run migrations, give the app role a login.
# Usage: scripts/setup-db.sh [database_name]   (defaults to tracknest)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

DB="${1:-tracknest}"
ADMIN_URL="${DATABASE_ADMIN_URL%/*}/$DB"
PASSWORD="${APP_DB_PASSWORD:?set APP_DB_PASSWORD in .env}"

psql "${ADMIN_URL%/*}/postgres" -tc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1 \
  || psql "${ADMIN_URL%/*}/postgres" -c "CREATE DATABASE $DB"

DATABASE_ADMIN_URL="$ADMIN_URL" pnpm exec drizzle-kit migrate

# Role is created NOLOGIN by the migration; the password never lives in the repo.
psql "$ADMIN_URL" -c "ALTER ROLE tracknest_app LOGIN PASSWORD '$PASSWORD'"
echo "Database $DB ready."
