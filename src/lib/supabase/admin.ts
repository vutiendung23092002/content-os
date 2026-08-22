import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireServerEnv } from "@/lib/env/server";

let adminClient: ReturnType<typeof createClient> | undefined;

export function createSupabaseAdminClient() {
  adminClient ??= createClient(
    requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireServerEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  return adminClient;
}

export function getAssetBucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "post-assets";
}
