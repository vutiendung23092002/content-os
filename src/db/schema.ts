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
  "canceled",
  "deleted_remote",
]);

export const postTypeEnum = applicationSchema.enum("post_type", [
  "text",
  "image",
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
]);

export const generationTypeEnum = applicationSchema.enum("generation_type", [
  "caption",
  "rewrite",
  "idea",
]);

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
    externalUserId: text("external_user_id"),
    status: connectionStatusEnum("status").notNull().default("error"),
    grantedScopes: text("granted_scopes")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
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

export const pageCredentials = applicationSchema.table(
  "page_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    accessTokenCiphertext: bytea("access_token_ciphertext").notNull(),
    nonce: bytea("nonce").notNull(),
    authTag: bytea("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull(),
    tokenFingerprint: text("token_fingerprint").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("page_credentials_page_id_unique").on(table.pageId)],
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
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("assets_storage_key_unique").on(table.storageKey),
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
    httpStatus: integer("http_status"),
    providerErrorCode: text("provider_error_code"),
    providerErrorMessage: text("provider_error_message"),
    providerRequestId: text("provider_request_id"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
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

export const schema = {
  appUsers,
  facebookConnection,
  pages,
  pageCredentials,
  assets,
  posts,
  postAssets,
  facebookOperations,
  aiGenerations,
  syncCursors,
};
