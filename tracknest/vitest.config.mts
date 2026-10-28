import { defineConfig } from "vitest/config";
import path from "node:path";

try {
  process.loadEnvFile(".env");
} catch {}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    // Tests run against <db>_test, created with: scripts/setup-db.sh tracknest_test
    env: { DATABASE_URL: `${process.env.DATABASE_URL}_test` },
    fileParallelism: false,
  },
});
