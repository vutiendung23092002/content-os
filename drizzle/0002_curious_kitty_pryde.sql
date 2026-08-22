CREATE TABLE "hancontent_os"."user_page_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hancontent_os"."user_page_assignments" ADD CONSTRAINT "user_page_assignments_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."user_page_assignments" ADD CONSTRAINT "user_page_assignments_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "hancontent_os"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."user_page_assignments" ADD CONSTRAINT "user_page_assignments_assigned_by_user_id_app_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_page_assignments_user_page_unique" ON "hancontent_os"."user_page_assignments" USING btree ("user_id","page_id");--> statement-breakpoint
CREATE INDEX "user_page_assignments_page_user_idx" ON "hancontent_os"."user_page_assignments" USING btree ("page_id","user_id");