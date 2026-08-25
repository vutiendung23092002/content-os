CREATE TABLE "hancontent_os"."cron_jobs" (
	"job_key" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cron_jobs_lease_expiry_idx" ON "hancontent_os"."cron_jobs" USING btree ("lease_expires_at");