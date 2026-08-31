import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
if (process.env.DATABASE_VERIFICATION_EXPLICIT_ENV !== "true") {
  loadEnvConfig(process.cwd());
}

const databaseUrl = process.env.DIRECT_DATABASE_URL;
const expectedTables = [
  "ai_generations",
  "app_users",
  "assets",
  "cron_jobs",
  "facebook_connection",
  "facebook_operations",
  "mutation_rate_limits",
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
const expectedRateLimitColumns = new Map([
  ["actor_id", "uuid"],
  ["page_scope", "text"],
  ["action", "text"],
  ["window_start", "timestamp with time zone"],
  ["request_count", "integer"],
  ["expires_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
]);

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

  const rateLimitColumns = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'hancontent_os'
      and table_name = 'mutation_rate_limits'
    order by ordinal_position
  `;
  const actualRateLimitColumnNames = rateLimitColumns.map(
    (column) => column.column_name,
  );
  const missingRateLimitColumns = [...expectedRateLimitColumns.keys()].filter(
    (column) => !actualRateLimitColumnNames.includes(column),
  );
  const unexpectedRateLimitColumns = actualRateLimitColumnNames.filter(
    (column) => !expectedRateLimitColumns.has(column),
  );
  const invalidRateLimitColumns = rateLimitColumns
    .filter(
      (column) =>
        expectedRateLimitColumns.get(column.column_name) !== column.data_type ||
        column.is_nullable !== "NO",
    )
    .map((column) => column.column_name);

  const rateLimitConstraints = await sql`
    select c.contype, pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'hancontent_os'
      and t.relname = 'mutation_rate_limits'
  `;
  const normalizedConstraints = rateLimitConstraints.map((constraint) => ({
    type: constraint.contype,
    definition: constraint.definition.toLowerCase().replaceAll('"', ""),
  }));
  const hasRateLimitPrimaryKey = normalizedConstraints.some(
    (constraint) =>
      constraint.type === "p" &&
      constraint.definition.includes(
        "primary key (actor_id, page_scope, action, window_start)",
      ),
  );
  const hasRateLimitActorForeignKey = normalizedConstraints.some(
    (constraint) =>
      constraint.type === "f" &&
      constraint.definition.includes("foreign key (actor_id)") &&
      constraint.definition.includes("hancontent_os.app_users(id)") &&
      constraint.definition.includes("on delete cascade"),
  );

  const rateLimitIndexes = await sql`
    select indexdef
    from pg_indexes
    where schemaname = 'hancontent_os'
      and tablename = 'mutation_rate_limits'
  `;
  const hasRateLimitExpiryIndex = rateLimitIndexes.some((index) =>
    index.indexdef.toLowerCase().replaceAll('"', "").includes("(expires_at)"),
  );

  const rateLimitSchema = {
    missingColumns: missingRateLimitColumns,
    unexpectedColumns: unexpectedRateLimitColumns,
    invalidColumns: invalidRateLimitColumns,
    compositePrimaryKey: hasRateLimitPrimaryKey,
    actorForeignKeyCascade: hasRateLimitActorForeignKey,
    expiryIndex: hasRateLimitExpiryIndex,
  };
  const rateLimitSchemaOk =
    missingRateLimitColumns.length === 0 &&
    unexpectedRateLimitColumns.length === 0 &&
    invalidRateLimitColumns.length === 0 &&
    hasRateLimitPrimaryKey &&
    hasRateLimitActorForeignKey &&
    hasRateLimitExpiryIndex;

  const ok =
    missingTables.length === 0 &&
    unexpectedTables.length === 0 &&
    rateLimitSchemaOk;
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
      rateLimitSchema,
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
