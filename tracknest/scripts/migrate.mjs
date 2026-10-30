// Production migrations (used by the Docker "migrate" service; local dev uses scripts/setup-db.sh).
// Runs every pending file in drizzle/ as the database owner, then lets the app role log in.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.APP_DB_PASSWORD;
if (!url || !appPassword) throw new Error("Set DATABASE_ADMIN_URL and APP_DB_PASSWORD");

const sql = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
// The role is created NOLOGIN by a migration; its password only ever lives in the environment.
await sql.unsafe(`ALTER ROLE tracknest_app LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
await sql.end();
console.log("Migrations applied.");
