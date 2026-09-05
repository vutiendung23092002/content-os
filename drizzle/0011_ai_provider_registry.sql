CREATE TABLE "hancontent_os"."ai_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "adapter_type" text NOT NULL,
  "base_url" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "api_key_ciphertext" bytea,
  "api_key_nonce" bytea,
  "api_key_auth_tag" bytea,
  "api_key_version" integer,
  "api_key_fingerprint" text,
  "provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_providers_name_unique" UNIQUE("name")
);--> statement-breakpoint
CREATE TABLE "hancontent_os"."ai_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_id" uuid NOT NULL,
  "remote_model_id" text NOT NULL,
  "display_name" text NOT NULL,
  "modality" text DEFAULT 'text' NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_models_provider_remote_unique" UNIQUE("provider_id", "remote_model_id")
);--> statement-breakpoint
CREATE TABLE "hancontent_os"."ai_task_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task" text NOT NULL,
  "model_id" uuid NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_task_bindings_task_unique" UNIQUE("task")
);--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD COLUMN "model_id" uuid;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD COLUMN "output_data" jsonb;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_providers" ADD CONSTRAINT "ai_providers_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_providers" ADD CONSTRAINT "ai_providers_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "hancontent_os"."ai_providers"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_task_bindings" ADD CONSTRAINT "ai_task_bindings_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "hancontent_os"."ai_models"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_task_bindings" ADD CONSTRAINT "ai_task_bindings_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD CONSTRAINT "ai_generations_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "hancontent_os"."app_users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD CONSTRAINT "ai_generations_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "hancontent_os"."ai_providers"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "hancontent_os"."ai_generations" ADD CONSTRAINT "ai_generations_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "hancontent_os"."ai_models"("id") ON DELETE set null;
