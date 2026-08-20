CREATE SCHEMA IF NOT EXISTS "hancontent_os";
--> statement-breakpoint
CREATE TYPE "hancontent_os"."connection_status" AS ENUM('active', 'expired', 'revoked', 'permission_missing', 'error');--> statement-breakpoint
CREATE TYPE "hancontent_os"."generation_type" AS ENUM('caption', 'rewrite', 'idea');--> statement-breakpoint
CREATE TYPE "hancontent_os"."operation_status" AS ENUM('pending', 'succeeded', 'failed', 'uncertain');--> statement-breakpoint
CREATE TYPE "hancontent_os"."operation_type" AS ENUM('sync_pages', 'publish_now', 'schedule', 'update', 'reschedule', 'cancel', 'sync_posts');--> statement-breakpoint
CREATE TYPE "hancontent_os"."post_status" AS ENUM('draft', 'submitting', 'scheduled', 'published', 'failed', 'uncertain', 'canceled', 'deleted_remote');--> statement-breakpoint
CREATE TYPE "hancontent_os"."post_type" AS ENUM('text', 'image');--> statement-breakpoint
CREATE TABLE "hancontent_os"."ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"page_id" uuid NOT NULL,
	"generation_type" "hancontent_os"."generation_type" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"template_version" text NOT NULL,
	"input_data" jsonb NOT NULL,
	"output_text" text,
	"usage_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_cost" numeric(14, 6),
	"status" "hancontent_os"."operation_status" DEFAULT 'pending' NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hancontent_os"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"checksum" text NOT NULL,
	"original_filename" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_file_size_positive" CHECK ("hancontent_os"."assets"."file_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "hancontent_os"."facebook_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_user_id" text,
	"status" "hancontent_os"."connection_status" DEFAULT 'error' NOT NULL,
	"granted_scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"token_expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hancontent_os"."facebook_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"post_id" uuid,
	"type" "hancontent_os"."operation_type" NOT NULL,
	"status" "hancontent_os"."operation_status" DEFAULT 'pending' NOT NULL,
	"remote_post_id" text,
	"request_fingerprint" text,
	"http_status" integer,
	"provider_error_code" text,
	"provider_error_message" text,
	"provider_request_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	CONSTRAINT "facebook_operations_duration_nonnegative" CHECK ("hancontent_os"."facebook_operations"."duration_ms" is null or "hancontent_os"."facebook_operations"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hancontent_os"."page_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"access_token_ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"token_fingerprint" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hancontent_os"."pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_page_id" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"avatar_url" text,
	"category" text,
	"timezone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"connection_status" "hancontent_os"."connection_status" DEFAULT 'error' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"remote_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hancontent_os"."post_assets" (
	"post_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"remote_media_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_assets_post_id_asset_id_pk" PRIMARY KEY("post_id","asset_id"),
	CONSTRAINT "post_assets_sort_order_nonnegative" CHECK ("hancontent_os"."post_assets"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hancontent_os"."posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"remote_post_id" text,
	"type" "hancontent_os"."post_type" DEFAULT 'text' NOT NULL,
	"message" text NOT NULL,
	"status" "hancontent_os"."post_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"remote_created_at" timestamp with time zone,
	"remote_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"remote_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_remote_status_requires_remote_id" CHECK ("hancontent_os"."posts"."status" not in ('scheduled', 'published') or "hancontent_os"."posts"."remote_post_id" is not null),
	CONSTRAINT "posts_scheduled_status_requires_time" CHECK ("hancontent_os"."posts"."status" <> 'scheduled' or "hancontent_os"."posts"."scheduled_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "hancontent_os"."sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"sync_type" text NOT NULL,
	"cursor" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD CONSTRAINT "ai_generations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "hancontent_os"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD CONSTRAINT "ai_generations_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "hancontent_os"."pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."assets" ADD CONSTRAINT "assets_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "hancontent_os"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD CONSTRAINT "facebook_operations_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "hancontent_os"."pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD CONSTRAINT "facebook_operations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "hancontent_os"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."page_credentials" ADD CONSTRAINT "page_credentials_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "hancontent_os"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."post_assets" ADD CONSTRAINT "post_assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "hancontent_os"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."post_assets" ADD CONSTRAINT "post_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "hancontent_os"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."posts" ADD CONSTRAINT "posts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "hancontent_os"."pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."sync_cursors" ADD CONSTRAINT "sync_cursors_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "hancontent_os"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_generations_page_created_idx" ON "hancontent_os"."ai_generations" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_storage_key_unique" ON "hancontent_os"."assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "facebook_operations_page_started_idx" ON "hancontent_os"."facebook_operations" USING btree ("page_id","started_at");--> statement-breakpoint
CREATE INDEX "facebook_operations_post_started_idx" ON "hancontent_os"."facebook_operations" USING btree ("post_id","started_at");--> statement-breakpoint
CREATE INDEX "facebook_operations_status_started_idx" ON "hancontent_os"."facebook_operations" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "page_credentials_page_id_unique" ON "hancontent_os"."page_credentials" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_external_page_id_unique" ON "hancontent_os"."pages" USING btree ("external_page_id");--> statement-breakpoint
CREATE INDEX "pages_connection_status_last_synced_idx" ON "hancontent_os"."pages" USING btree ("connection_status","last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_assets_post_sort_unique" ON "hancontent_os"."post_assets" USING btree ("post_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_page_remote_post_unique" ON "hancontent_os"."posts" USING btree ("page_id","remote_post_id") WHERE "hancontent_os"."posts"."remote_post_id" is not null;--> statement-breakpoint
CREATE INDEX "posts_page_status_schedule_idx" ON "hancontent_os"."posts" USING btree ("page_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "posts_page_published_idx" ON "hancontent_os"."posts" USING btree ("page_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_page_type_unique" ON "hancontent_os"."sync_cursors" USING btree ("page_id","sync_type");
