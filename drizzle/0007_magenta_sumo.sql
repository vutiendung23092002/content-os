CREATE TABLE "hancontent_os"."mutation_rate_limits" (
	"actor_id" uuid NOT NULL,
	"page_scope" text NOT NULL,
	"action" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_rate_limits_actor_id_page_scope_action_window_start_pk" PRIMARY KEY("actor_id","page_scope","action","window_start")
);
--> statement-breakpoint
ALTER TABLE "hancontent_os"."mutation_rate_limits" ADD CONSTRAINT "mutation_rate_limits_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mutation_rate_limits_expiry_idx" ON "hancontent_os"."mutation_rate_limits" USING btree ("expires_at");