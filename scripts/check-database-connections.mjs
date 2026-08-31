import nextEnv from "@next/env";
import postgres from "postgres";
import { shouldLoadDefaultEnvironment } from "./explicit-environment.mjs";

const { loadEnvConfig } = nextEnv;

if (shouldLoadDefaultEnvironment()) loadEnvConfig(process.cwd());

const connectionKeys = ["DATABASE_URL", "DIRECT_DATABASE_URL"];
let failed = false;

for (const key of connectionKeys) {
  const value = process.env[key];

  if (!value || value.includes("user:password@host")) {
    console.log(
      JSON.stringify({ key, ok: false, code: "MISSING_OR_PLACEHOLDER" }),
    );
    failed = true;
    continue;
  }

  const sql = postgres(value, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 2,
  });

  try {
    await sql`select 1 as connection_check`;
    console.log(JSON.stringify({ key, ok: true }));
  } catch (error) {
    console.log(
      JSON.stringify({
        key,
        ok: false,
        code: error?.code ?? error?.name ?? "CONNECTION_FAILED",
      }),
    );
    failed = true;
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

if (failed) {
  process.exitCode = 1;
}
