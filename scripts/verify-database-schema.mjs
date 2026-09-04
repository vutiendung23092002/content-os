import nextEnv from "@next/env";
import postgres from "postgres";
import { shouldLoadDefaultEnvironment } from "./explicit-environment.mjs";

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
        'page_credentials_connection_idx'
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
  ];
  const missingFacebookSchemaIndexes = expectedFacebookSchemaIndexes.filter(
    (index) => !facebookSchemaIndexNames.includes(index),
  );

  const facebookSchemaConstraints = await sql`
    select c.conname
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'hancontent_os'
      and c.conname in (
        'facebook_oauth_states_app_user_id_app_users_id_fk',
        'facebook_connection_app_user_id_app_users_id_fk',
        'page_credentials_facebook_connection_id_facebook_connection_id_fk',
        'user_page_assignments_facebook_connection_id_facebook_connection_id_fk',
        'facebook_connection_user_connected_fields'
      )
  `;
  const facebookSchemaConstraintNames = facebookSchemaConstraints.map(
    (constraint) => constraint.conname,
  );
  const expectedFacebookSchemaConstraints = [
    "facebook_oauth_states_app_user_id_app_users_id_fk",
    "facebook_connection_app_user_id_app_users_id_fk",
    "page_credentials_facebook_connection_id_facebook_connection_id_fk",
    "user_page_assignments_facebook_connection_id_facebook_connection_id_fk",
    "facebook_connection_user_connected_fields",
  ];
  const missingFacebookSchemaConstraints =
    expectedFacebookSchemaConstraints.filter(
      (constraint) => !facebookSchemaConstraintNames.includes(constraint),
    );

  const facebookConnectSchema = {
    missingOauthColumns: missingFacebookOauthColumns,
    invalidOauthColumns: invalidFacebookOauthColumns,
    missingConnectionColumns: missingFacebookConnectionColumns,
    credentialProvenance: provenanceTables.includes("page_credentials"),
    assignmentProvenance: provenanceTables.includes("user_page_assignments"),
    credentialMetadata: hasCredentialMetadata,
    connectionTypes: facebookConnectionTypes.map((entry) => entry.value),
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
