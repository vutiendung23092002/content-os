ALTER TYPE "hancontent_os"."operation_status" ADD VALUE 'needs_attention';--> statement-breakpoint
ALTER TYPE "hancontent_os"."post_status" ADD VALUE 'needs_attention' BEFORE 'canceled';--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "resolution_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "resolved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD CONSTRAINT "facebook_operations_resolved_by_user_id_app_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE set null ON UPDATE no action;