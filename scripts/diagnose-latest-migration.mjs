import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import postgres from "postgres";
import { shouldLoadDefaultEnvironment } from "./explicit-environment.mjs";

const { loadEnvConfig } = nextEnv;
if (shouldLoadDefaultEnvironment()) loadEnvConfig(process.cwd());

const databaseUrl = process.env.DIRECT_DATABASE_URL;
if (!databaseUrl) {
  console.error(
    JSON.stringify({ ok: false, code: "DIRECT_DATABASE_URL_MISSING" }),
  );
  process.exit(1);
}

const migrationDirectory = path.resolve(process.cwd(), "drizzle");
const migrationFile = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .at(-1);

if (!migrationFile) {
  console.error(JSON.stringify({ ok: false, code: "MIGRATION_FILE_MISSING" }));
  process.exit(1);
}

const migration = await readFile(
  path.join(migrationDirectory, migrationFile),
  "utf8",
);
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});
const connection = await sql.reserve();

try {
  await connection.unsafe("begin");

  for (const [index, statement] of statements.entries()) {
    try {
      await connection.unsafe(statement);
    } catch (error) {
      console.error(
        JSON.stringify({
          ok: false,
          migrationFile,
          statementNumber: index + 1,
          code: error?.code ?? error?.name ?? "MIGRATION_STATEMENT_FAILED",
          message: error?.message ?? "Migration statement failed",
        }),
      );
      process.exitCode = 1;
      break;
    }
  }

  if (!process.exitCode) {
    console.log(
      JSON.stringify({
        ok: true,
        migrationFile,
        statements: statements.length,
      }),
    );
  }
} finally {
  await connection.unsafe("rollback").catch(() => undefined);
  connection.release();
  await sql.end({ timeout: 2 }).catch(() => undefined);
}
