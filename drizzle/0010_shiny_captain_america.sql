CREATE TYPE "hancontent_os"."facebook_credential_source" AS ENUM('admin_managed', 'user_connected', 'legacy_admin');--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "credential_source" "hancontent_os"."facebook_credential_source";--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "facebook_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "page_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD CONSTRAINT "facebook_operations_facebook_connection_id_facebook_connection_id_fk" FOREIGN KEY ("facebook_connection_id") REFERENCES "hancontent_os"."facebook_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD CONSTRAINT "facebook_operations_page_credential_id_page_credentials_id_fk" FOREIGN KEY ("page_credential_id") REFERENCES "hancontent_os"."page_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hancontent_os"."facebook_operations" ADD CONSTRAINT "facebook_operations_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facebook_operations_connection_idx" ON "hancontent_os"."facebook_operations" USING btree ("facebook_connection_id");--> statement-breakpoint
CREATE INDEX "facebook_operations_credential_idx" ON "hancontent_os"."facebook_operations" USING btree ("page_credential_id");