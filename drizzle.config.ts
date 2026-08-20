import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

const migrationUrl = process.env.DIRECT_DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    "DIRECT_DATABASE_URL is required to run Drizzle migration commands.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: migrationUrl,
  },
  strict: true,
  verbose: true,
});
