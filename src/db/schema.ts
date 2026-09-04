import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const applicationSchema = pgSchema("hancontent_os");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const connectionStatusEnum = applicationSchema.enum(
  "connection_status",
  ["active", "expired", "revoked", "permission_missing", "error"],
);

export const appRoleEnum = applicationSchema.enum("app_role", [
  "super_admin",
  "admin",
  "member",
]);

export const userApprovalStatusEnum = applicationSchema.enum(
  "user_approval_status",
  ["pending", "approved", "rejected", "suspended"],
);

export const postStatusEnum = applicationSchema.enum("post_status", [
  "draft",
  "submitting",
  "scheduled",
  "published",
  "failed",
  "uncertain",
  "needs_attention",
  "canceled",
  "deleted_remote",
]);

export const postTypeEnum = applicationSchema.enum("post_type", [
  "text",
  "image",
  "video",
]);

export const operationTypeEnum = applicationSchema.enum("operation_type", [
  "sync_pages",
  "publish_now",
  "schedule",
  "update",
  "reschedule",
  "cancel",
  "sync_posts",
]);

export const operationStatusEnum = applicationSchema.enum("operation_status", [
  "pending",
  "succeeded",
  "failed",
  "uncertain",
  "needs_attention",
]);

export const generationTypeEnum = applicationSchema.enum("generation_type", [
  "caption",
  "rewrite",
  "idea",
]);

export const facebookConnectionTypeEnum = applicationSchema.enum(
  "facebook_connection_type",
  ["admin_managed", "user_connected"],
);

export const facebookCredentialSourceEnum = applicationSchema.enum(
  "facebook_credential_source",
  ["admin_managed", "user_connected", "legacy_admin"],
);

export const appUsers = applicationSchema.table(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalUserId: text("external_user_id"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    role: appRoleEnum("role").notNull().default("member"),
    approvalStatus: userApprovalStatusEnum("approval_status")
      .notNull()
      .default("pending"),
    approvedByUserId: uuid("approved_by_user_id").references(
      (): AnyPgColumn => appUsers.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    isBootstrapSuperAdmin: boolean("is_bootstrap_super_admin")
      .notNull()
      .default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("app_users_external_user_id_unique").on(table.externalUserId),
    uniqueIndex("app_users_email_unique").on(table.email),
    uniqueIndex("app_users_single_bootstrap_super_admin")
      .on(table.isBootstrapSuperAdmin)
      .where(sql`${table.isBootstrapSuperAdmin} = true`),
    index("app_users_approval_role_idx").on(table.approvalStatus, table.role),
  ],
);

export const facebookConnection = applicationSchema.table(
  "facebook_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appUserId: uuid("app_user_id").references(() => appUsers.id, {
      onDelete: "cascade",
    }),
    externalUserId: text("external_user_id"),
    metaAppId: text("meta_app_id"),
    connectionType: facebookConnectionTypeEnum("connection_type")
      .notNull()
      .default("admin_managed"),
    status: connectionStatusEnum("status").notNull().default("error"),
    accountName: text("account_name"),
    accountAvatarUrl: text("account_avatar_url"),
    grantedScopes: text("granted_scopes")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    dataAccessExpiresAt: timestamp("data_access_expires_at", {
      withTimezone: true,
    }),
    userTokenCiphertext: bytea("user_token_ciphertext"),
    userTokenNonce: bytea("user_token_nonce"),
    userTokenAuthTag: bytea("user_token_auth_tag"),
    userTokenKeyVersion: integer("user_token_key_version"),
    userTokenFingerprint: text("user_token_fingerprint"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("facebook_connection_user_app_type_unique")
      .on(table.appUserId, table.metaAppId, table.connectionType)
      .where(sql`${table.appUserId} is not null`),
    index("facebook_connection_user_status_idx").on(
      table.appUserId,
      table.status,
    ),
    check(
      "facebook_connection_user_connected_fields",
      sql`${table.connectionType} <> 'user_connected' or (${table.appUserId} is not null and ${table.externalUserId} is not null and ${table.metaAppId} is not null and ${table.userTokenCiphertext} is not null and ${table.userTokenNonce} is not null and ${table.userTokenAuthTag} is not null and ${table.userTokenKeyVersion} is not null and ${table.userTokenFingerprint} is not null)`,
    ),
  ],
);

export const pages = applicationSchema.table(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalPageId: text("external_page_id").notNull(),
    name: text("name").notNull(),
    username: text("username"),
    avatarUrl: text("avatar_url"),
    category: text("category"),
    timezone: text("timezone"),
    isActive: boolean("is_active").notNull().default(true),
    connectionStatus: connectionStatusEnum("connection_status")
      .notNull()
      .default("error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    remoteMetadata: jsonb("remote_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pages_external_page_id_unique").on(table.externalPageId),
    index("pages_connection_status_last_synced_idx").on(
      table.connectionStatus,
      table.lastSyncedAt,
    ),
  ],
);

export const userPageAssignments = applicationSchema.table(
  "user_page_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    assignedByUserId: uuid("assigned_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    facebookConnectionId: uuid("facebook_connection_id").references(
      () => facebookConnection.id,
      { onDelete: "set null" },
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_page_assignments_user_page_unique").on(
      table.userId,
      table.pageId,
    ),
    index("user_page_assignments_page_user_idx").on(table.pageId, table.userId),
  ],
);

export const pageCredentials = applicationSchema.table(
  "page_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    facebookConnectionId: uuid("facebook_connection_id").references(
      () => facebookConnection.id,
      { onDelete: "restrict" },
    ),
    accessTokenCiphertext: bytea("access_token_ciphertext").notNull(),
    nonce: bytea("nonce").notNull(),
    authTag: bytea("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull(),
    tokenFingerprint: text("token_fingerprint").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("page_credentials_legacy_page_unique")
      .on(table.pageId)
      .where(sql`${table.facebookConnectionId} is null`),
    uniqueIndex("page_credentials_page_connection_unique").on(
      table.pageId,
      table.facebookConnectionId,
    ),
    index("page_credentials_connection_idx").on(table.facebookConnectionId),
  ],
);

export const facebookOauthStates = applicationSchema.table(
  "facebook_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    redirectPath: text("redirect_path").notNull().default("/pages"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("facebook_oauth_states_expiry_idx").on(table.expiresAt)],
);

export const assets = applicationSchema.table(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: bigint("file_size", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum").notNull(),
    originalFilename: text("original_filename").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    cleanupClaimedAt: timestamp("cleanup_claimed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("assets_storage_key_unique").on(table.storageKey),
    index("assets_cleanup_idx").on(
      table.deletedAt,
      table.cleanupClaimedAt,
      table.createdAt,
    ),
    check("assets_file_size_positive", sql`${table.fileSize} > 0`),
  ],
);

export const posts = applicationSchema.table(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "restrict" }),
    remotePostId: text("remote_post_id"),
    type: postTypeEnum("type").notNull().default("text"),
    message: text("message").notNull(),
    status: postStatusEnum("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    remoteCreatedAt: timestamp("remote_created_at", { withTimezone: true }),
    remoteUpdatedAt: timestamp("remote_updated_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    remoteSnapshot: jsonb("remote_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("posts_page_remote_post_unique")
      .on(table.pageId, table.remotePostId)
      .where(sql`${table.remotePostId} is not null`),
    index("posts_page_status_schedule_idx").on(
      table.pageId,
      table.status,
      table.scheduledAt,
    ),
    index("posts_page_published_idx").on(table.pageId, table.publishedAt),
    check(
      "posts_remote_status_requires_remote_id",
      sql`${table.status} not in ('scheduled', 'published') or ${table.remotePostId} is not null`,
    ),
    check(
      "posts_scheduled_status_requires_time",
      sql`${table.status} <> 'scheduled' or ${table.scheduledAt} is not null`,
    ),
  ],
);

export const postAssets = applicationSchema.table(
  "post_assets",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull(),
    remoteMediaId: text("remote_media_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.assetId] }),
    uniqueIndex("post_assets_post_sort_unique").on(
      table.postId,
      table.sortOrder,
    ),
    check("post_assets_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const facebookOperations = applicationSchema.table(
  "facebook_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "restrict" }),
    postId: uuid("post_id").references(() => posts.id, {
      onDelete: "set null",
    }),
    type: operationTypeEnum("type").notNull(),
    status: operationStatusEnum("status").notNull().default("pending"),
    remotePostId: text("remote_post_id"),
    requestFingerprint: text("request_fingerprint"),
    requestMetadata: jsonb("request_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    credentialSource: facebookCredentialSourceEnum("credential_source"),
    facebookConnectionId: uuid("facebook_connection_id").references(
      () => facebookConnection.id,
      { onDelete: "restrict" },
    ),
    pageCredentialId: uuid("page_credential_id").references(
      () => pageCredentials.id,
      { onDelete: "set null" },
    ),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    httpStatus: integer("http_status"),
    providerErrorCode: text("provider_error_code"),
    providerErrorMessage: text("provider_error_message"),
    providerRequestId: text("provider_request_id"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    resolution: text("resolution"),
    resolutionEvidence: jsonb("resolution_evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    resolvedByUserId: uuid("resolved_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("facebook_operations_page_started_idx").on(
      table.pageId,
      table.startedAt,
    ),
    index("facebook_operations_post_started_idx").on(
      table.postId,
      table.startedAt,
    ),
    index("facebook_operations_status_started_idx").on(
      table.status,
      table.startedAt,
    ),
    index("facebook_operations_connection_idx").on(table.facebookConnectionId),
    index("facebook_operations_credential_idx").on(table.pageCredentialId),
    check(
      "facebook_operations_duration_nonnegative",
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
  ],
);

export const aiGenerations = applicationSchema.table(
  "ai_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").references(() => posts.id, {
      onDelete: "set null",
    }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "restrict" }),
    generationType: generationTypeEnum("generation_type").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    templateVersion: text("template_version").notNull(),
    inputData: jsonb("input_data").$type<Record<string, unknown>>().notNull(),
    outputText: text("output_text"),
    usageData: jsonb("usage_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    estimatedCost: numeric("estimated_cost", { precision: 14, scale: 6 }),
    status: operationStatusEnum("status").notNull().default("pending"),
    error: jsonb("error").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_generations_page_created_idx").on(table.pageId, table.createdAt),
  ],
);

export const syncCursors = applicationSchema.table(
  "sync_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    syncType: text("sync_type").notNull(),
    cursor: text("cursor"),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: jsonb("last_error").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sync_cursors_page_type_unique").on(
      table.pageId,
      table.syncType,
    ),
  ],
);

export const cronJobs = applicationSchema.table(
  "cron_jobs",
  {
    jobKey: text("job_key").primaryKey(),
    cursor: text("cursor"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: jsonb("last_error").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("cron_jobs_lease_expiry_idx").on(table.leaseExpiresAt)],
);

export const mutationRateLimits = applicationSchema.table(
  "mutation_rate_limits",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    pageScope: text("page_scope").notNull(),
    action: text("action").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.actorId,
        table.pageScope,
        table.action,
        table.windowStart,
      ],
    }),
    index("mutation_rate_limits_expiry_idx").on(table.expiresAt),
  ],
);

export const schema = {
  appUsers,
  facebookConnection,
  facebookOauthStates,
  pages,
  userPageAssignments,
  pageCredentials,
  assets,
  posts,
  postAssets,
  facebookOperations,
  aiGenerations,
  syncCursors,
  cronJobs,
  mutationRateLimits,
};
