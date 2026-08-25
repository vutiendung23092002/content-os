import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DIRECT_DATABASE_URL;
const expectedTables = [
  "ai_generations",
  "app_users",
  "assets",
  "cron_jobs",
  "facebook_connection",
  "facebook_operations",
  "page_credentials",
  "pages",
  "post_assets",
  "posts",
  "sync_cursors",
  "user_page_assignments",
];
const knownLegacyTables = [
  "app_sessions",
  "user_credentials",
  "user_page_access",
];

if (!databaseUrl) {
  console.error(
    JSON.stringify({ ok: false, code: "DIRECT_DATABASE_URL_MISSING" }),
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 2,
});

try {
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'hancontent_os'
      and table_type = 'BASE TABLE'
    order by table_name
  `;
  const actualTables = tables.map((row) => row.table_name);
  const missingTables = expectedTables.filter(
    (table) => !actualTables.includes(table),
  );
  const unexpectedTables = actualTables.filter(
    (table) =>
      !expectedTables.includes(table) && !knownLegacyTables.includes(table),
  );
  const legacyTables = actualTables.filter((table) =>
    knownLegacyTables.includes(table),
  );

  const [metadata] = await sql`
    select
      count(*) filter (where c.contype = 'f')::int as foreign_keys,
      count(*) filter (where c.contype = 'c')::int as check_constraints
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'hancontent_os'
  `;

  const ok = missingTables.length === 0 && unexpectedTables.length === 0;
  console.log(
    JSON.stringify({
      ok,
      schema: "hancontent_os",
      tables: actualTables,
      foreignKeys: metadata?.foreign_keys ?? 0,
      checkConstraints: metadata?.check_constraints ?? 0,
      missingTables,
      unexpectedTables,
      legacyTables,
    }),
  );

  if (!ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error?.code ?? error?.name ?? "SCHEMA_VERIFICATION_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 }).catch(() => undefined);
}
