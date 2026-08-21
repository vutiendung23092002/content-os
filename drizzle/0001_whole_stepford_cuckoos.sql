DO $$ BEGIN
 CREATE TYPE "hancontent_os"."app_role" AS ENUM('super_admin', 'admin', 'member');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "hancontent_os"."user_approval_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hancontent_os"."app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_user_id" text,
	"email" text,
	"name" text NOT NULL,
	"avatar_url" text,
	"role" "hancontent_os"."app_role" DEFAULT 'member' NOT NULL,
	"approval_status" "hancontent_os"."user_approval_status" DEFAULT 'pending' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"is_bootstrap_super_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hancontent_os"."app_users" ADD COLUMN IF NOT EXISTS "email" text;
--> statement-breakpoint
ALTER TABLE "hancontent_os"."app_users" ALTER COLUMN "external_user_id" DROP NOT NULL;
--> statement-breakpoint
UPDATE "hancontent_os"."app_users"
SET "email" = lower(coalesce("external_user_id", "id"::text) || '@legacy.invalid')
WHERE "email" IS NULL;
--> statement-breakpoint
ALTER TABLE "hancontent_os"."app_users" ALTER COLUMN "email" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hancontent_os"."app_users"
 ADD CONSTRAINT "app_users_approved_by_user_id_app_users_id_fk"
 FOREIGN KEY ("approved_by_user_id") REFERENCES "hancontent_os"."app_users"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_external_user_id_unique" ON "hancontent_os"."app_users" USING btree ("external_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_email_unique" ON "hancontent_os"."app_users" USING btree ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_single_bootstrap_super_admin" ON "hancontent_os"."app_users" USING btree ("is_bootstrap_super_admin") WHERE "hancontent_os"."app_users"."is_bootstrap_super_admin" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_users_approval_role_idx" ON "hancontent_os"."app_users" USING btree ("approval_status","role");
