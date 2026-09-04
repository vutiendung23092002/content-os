CREATE TYPE "hancontent_os"."facebook_connection_type" AS ENUM('admin_managed', 'user_connected');--> statement-breakpoint
CREATE TABLE "hancontent_os"."facebook_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"app_user_id" uuid NOT NULL,
	"redirect_path" text DEFAULT '/pages' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "hancontent_os"."page_credentials_page_id_unique";--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "app_user_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "meta_app_id" text;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "connection_type" "hancontent_os"."facebook_connection_type" DEFAULT 'admin_managed' NOT NULL;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "account_name" text;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "account_avatar_url" text;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "data_access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "user_token_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "user_token_nonce" "bytea";--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "user_token_auth_tag" "bytea";--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "user_token_key_version" integer;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "user_token_fingerprint" text;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD COLUMN "disconnected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hancontent_os"."page_credentials" ADD COLUMN "facebook_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."user_page_assignments" ADD COLUMN "facebook_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_oauth_states" ADD CONSTRAINT "facebook_oauth_states_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facebook_oauth_states_expiry_idx" ON "hancontent_os"."facebook_oauth_states" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD CONSTRAINT "facebook_connection_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."page_credentials" ADD CONSTRAINT "page_credentials_facebook_connection_id_facebook_connection_id_fk" FOREIGN KEY ("facebook_connection_id") REFERENCES "hancontent_os"."facebook_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."user_page_assignments" ADD CONSTRAINT "user_page_assignments_facebook_connection_id_facebook_connection_id_fk" FOREIGN KEY ("facebook_connection_id") REFERENCES "hancontent_os"."facebook_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "facebook_connection_user_app_type_unique" ON "hancontent_os"."facebook_connection" USING btree ("app_user_id","meta_app_id","connection_type") WHERE "hancontent_os"."facebook_connection"."app_user_id" is not null;--> statement-breakpoint
CREATE INDEX "facebook_connection_user_status_idx" ON "hancontent_os"."facebook_connection" USING btree ("app_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "page_credentials_legacy_page_unique" ON "hancontent_os"."page_credentials" USING btree ("page_id") WHERE "hancontent_os"."page_credentials"."facebook_connection_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "page_credentials_page_connection_unique" ON "hancontent_os"."page_credentials" USING btree ("page_id","facebook_connection_id");--> statement-breakpoint
CREATE INDEX "page_credentials_connection_idx" ON "hancontent_os"."page_credentials" USING btree ("facebook_connection_id");--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_connection" ADD CONSTRAINT "facebook_connection_user_connected_fields" CHECK ("hancontent_os"."facebook_connection"."connection_type" <> 'user_connected' or ("hancontent_os"."facebook_connection"."app_user_id" is not null and "hancontent_os"."facebook_connection"."external_user_id" is not null and "hancontent_os"."facebook_connection"."meta_app_id" is not null and "hancontent_os"."facebook_connection"."user_token_ciphertext" is not null and "hancontent_os"."facebook_connection"."user_token_nonce" is not null and "hancontent_os"."facebook_connection"."user_token_auth_tag" is not null and "hancontent_os"."facebook_connection"."user_token_key_version" is not null and "hancontent_os"."facebook_connection"."user_token_fingerprint" is not null));