import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "post-assets";

if (!projectUrl || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}

const client = createClient(projectUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { error } = await client.storage.updateBucket(bucket, {
  public: false,
  fileSizeLimit: 50 * 1024 * 1024,
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/quicktime",
  ],
});

if (error) throw error;
console.log(`Configured private media bucket: ${bucket}`);
