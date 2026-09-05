import nextEnv from "@next/env";
import postgres from "postgres";
import { shouldLoadDefaultEnvironment } from "./explicit-environment.mjs";
import { findMissingFacebookForeignKeys } from "./verify-database-schema-core.mjs";

const { loadEnvConfig } = nextEnv;
if (shouldLoadDefaultEnvironment()) loadEnvConfig(process.cwd());

const databaseUrl = process.env.DIRECT_DATABASE_URL;
const expectedTables = [
  "ai_generations",
  "app_users",
  "assets",
  "cron_jobs",
  "facebook_connection",
  "facebook_oauth_states",
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
const expectedFacebookOauthColumns = new Map([
  ["state_hash", ["text", "NO"]],
  ["app_user_id", ["uuid", "NO"]],
  ["redirect_path", ["text", "NO"]],
  ["expires_at", ["timestamp with time zone", "NO"]],
  ["consumed_at", ["timestamp with time zone", "YES"]],
  ["created_at", ["timestamp with time zone", "NO"]],
]);
const expectedFacebookConnectionColumns = [
  "app_user_id",
  "meta_app_id",
  "connection_type",
  "account_name",
  "account_avatar_url",
  "data_access_expires_at",
  "user_token_ciphertext",
  "user_token_nonce",
  "user_token_auth_tag",
  "user_token_key_version",
  "user_token_fingerprint",
  "disconnected_at",
];
const expectedFacebookOperationProvenanceColumns = [
  "credential_source",
  "facebook_connection_id",
  "page_credential_id",
  "actor_user_id",
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

  const facebookOauthColumns = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'hancontent_os'
      and table_name = 'facebook_oauth_states'
    order by ordinal_position
  `;
  const facebookOauthColumnNames = facebookOauthColumns.map(
    (column) => column.column_name,
  );
  const missingFacebookOauthColumns = [
    ...expectedFacebookOauthColumns.keys(),
  ].filter((column) => !facebookOauthColumnNames.includes(column));
  const invalidFacebookOauthColumns = facebookOauthColumns
    .filter((column) => {
      const expected = expectedFacebookOauthColumns.get(column.column_name);
      return (
        !expected ||
        expected[0] !== column.data_type ||
        expected[1] !== column.is_nullable
      );
    })
    .map((column) => column.column_name);

  const facebookConnectionColumns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'hancontent_os'
      and table_name = 'facebook_connection'
  `;
  const facebookConnectionColumnNames = facebookConnectionColumns.map(
    (column) => column.column_name,
  );
  const missingFacebookConnectionColumns =
    expectedFacebookConnectionColumns.filter(
      (column) => !facebookConnectionColumnNames.includes(column),
    );

  const provenanceColumns = await sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'hancontent_os'
      and table_name in ('page_credentials', 'user_page_assignments')
      and column_name = 'facebook_connection_id'
  `;
  const provenanceTables = provenanceColumns.map((column) => column.table_name);
  const credentialMetadataColumns = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'hancontent_os'
      and table_name = 'page_credentials'
      and column_name = 'provider_metadata'
  `;
  const hasCredentialMetadata = credentialMetadataColumns.some(
    (column) => column.data_type === "jsonb" && column.is_nullable === "NO",
  );

  const facebookConnectionTypes = await sql`
    select e.enumlabel as value
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'hancontent_os'
      and t.typname = 'facebook_connection_type'
    order by e.enumsortorder
  `;
  const facebookCredentialSources = await sql`
    select e.enumlabel as value
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'hancontent_os'
      and t.typname = 'facebook_credential_source'
    order by e.enumsortorder
  `;
  const facebookOperationColumns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'hancontent_os'
      and table_name = 'facebook_operations'
  `;
  const facebookOperationColumnNames = facebookOperationColumns.map(
    (column) => column.column_name,
  );
  const missingFacebookOperationProvenanceColumns =
    expectedFacebookOperationProvenanceColumns.filter(
      (column) => !facebookOperationColumnNames.includes(column),
    );

  const facebookSchemaIndexes = await sql`
    select indexname
    from pg_indexes
    where schemaname = 'hancontent_os'
      and indexname in (
        'facebook_oauth_states_expiry_idx',
        'facebook_connection_user_app_type_unique',
        'facebook_connection_user_status_idx',
        'page_credentials_legacy_page_unique',
        'page_credentials_page_connection_unique',
        'page_credentials_connection_idx',
        'facebook_operations_connection_idx',
        'facebook_operations_credential_idx'
      )
  `;
  const facebookSchemaIndexNames = facebookSchemaIndexes.map(
    (index) => index.indexname,
  );
  const expectedFacebookSchemaIndexes = [
    "facebook_oauth_states_expiry_idx",
    "facebook_connection_user_app_type_unique",
    "facebook_connection_user_status_idx",
    "page_credentials_legacy_page_unique",
    "page_credentials_page_connection_unique",
    "page_credentials_connection_idx",
    "facebook_operations_connection_idx",
    "facebook_operations_credential_idx",
  ];
  const missingFacebookSchemaIndexes = expectedFacebookSchemaIndexes.filter(
    (index) => !facebookSchemaIndexNames.includes(index),
  );

  const facebookForeignKeys = await sql`
    select
      source_namespace.nspname as source_schema,
      source_table.relname as source_table,
      array_agg(source_column.attname order by source_key.ordinality) as source_columns,
      target_namespace.nspname as target_schema,
      target_table.relname as target_table,
      array_agg(target_column.attname order by source_key.ordinality) as target_columns,
      case constraint_record.confdeltype
        when 'a' then 'NO ACTION'
        when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'
        when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT'
      end as on_delete
    from pg_constraint constraint_record
    join pg_class source_table
      on source_table.oid = constraint_record.conrelid
    join pg_namespace source_namespace
      on source_namespace.oid = source_table.relnamespace
    join pg_class target_table
      on target_table.oid = constraint_record.confrelid
    join pg_namespace target_namespace
      on target_namespace.oid = target_table.relnamespace
    cross join lateral unnest(constraint_record.conkey)
      with ordinality as source_key(attnum, ordinality)
    join pg_attribute source_column
      on source_column.attrelid = source_table.oid
      and source_column.attnum = source_key.attnum
      and not source_column.attisdropped
    cross join lateral unnest(constraint_record.confkey)
      with ordinality as target_key(attnum, ordinality)
    join pg_attribute target_column
      on target_column.attrelid = target_table.oid
      and target_column.attnum = target_key.attnum
      and target_key.ordinality = source_key.ordinality
      and not target_column.attisdropped
    where constraint_record.contype = 'f'
      and source_namespace.nspname = 'hancontent_os'
    group by
      constraint_record.oid,
      source_namespace.nspname,
      source_table.relname,
      target_namespace.nspname,
      target_table.relname,
      constraint_record.confdeltype
  `;
  const missingFacebookForeignKeyConstraints = findMissingFacebookForeignKeys(
    facebookForeignKeys.map((foreignKey) => ({
      sourceSchema: foreignKey.source_schema,
      sourceTable: foreignKey.source_table,
      sourceColumns: foreignKey.source_columns,
      targetSchema: foreignKey.target_schema,
      targetTable: foreignKey.target_table,
      targetColumns: foreignKey.target_columns,
      onDelete: foreignKey.on_delete,
    })),
  );
  const facebookCheckConstraints = await sql`
    select c.conname
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'hancontent_os'
      and c.conname = 'facebook_connection_user_connected_fields'
  `;
  const missingFacebookSchemaConstraints = [
    ...missingFacebookForeignKeyConstraints,
    ...(facebookCheckConstraints.length === 0
      ? ["facebook_connection_user_connected_fields"]
      : []),
  ];

  const facebookConnectSchema = {
    missingOauthColumns: missingFacebookOauthColumns,
    invalidOauthColumns: invalidFacebookOauthColumns,
    missingConnectionColumns: missingFacebookConnectionColumns,
    credentialProvenance: provenanceTables.includes("page_credentials"),
    assignmentProvenance: provenanceTables.includes("user_page_assignments"),
    credentialMetadata: hasCredentialMetadata,
    connectionTypes: facebookConnectionTypes.map((entry) => entry.value),
    operationCredentialSources: facebookCredentialSources.map(
      (entry) => entry.value,
    ),
    missingOperationProvenanceColumns:
      missingFacebookOperationProvenanceColumns,
    missingIndexes: missingFacebookSchemaIndexes,
    missingConstraints: missingFacebookSchemaConstraints,
  };
  const facebookConnectSchemaOk =
    missingFacebookOauthColumns.length === 0 &&
    invalidFacebookOauthColumns.length === 0 &&
    missingFacebookConnectionColumns.length === 0 &&
    provenanceTables.includes("page_credentials") &&
    provenanceTables.includes("user_page_assignments") &&
    hasCredentialMetadata &&
    facebookConnectSchema.connectionTypes.join(",") ===
      "admin_managed,user_connected" &&
    facebookConnectSchema.operationCredentialSources.join(",") ===
      "admin_managed,user_connected,legacy_admin" &&
    missingFacebookOperationProvenanceColumns.length === 0 &&
    missingFacebookSchemaIndexes.length === 0 &&
    missingFacebookSchemaConstraints.length === 0;

  const ok =
    missingTables.length === 0 &&
    unexpectedTables.length === 0 &&
    rateLimitSchemaOk &&
    facebookConnectSchemaOk;
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
      facebookConnectSchema,
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
