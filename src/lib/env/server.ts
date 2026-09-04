import "server-only";
import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: optionalSecret,
  DIRECT_DATABASE_URL: optionalSecret,
  FACEBOOK_APP_ID: optionalSecret,
  FACEBOOK_APP_SECRET: optionalSecret,
  FACEBOOK_GRAPH_API_VERSION: optionalSecret,
  FACEBOOK_USER_ACCESS_TOKEN: optionalSecret,
  FACEBOOK_CONNECT_APP_ID: optionalSecret,
  FACEBOOK_CONNECT_APP_SECRET: optionalSecret,
  FACEBOOK_CONNECT_REDIRECT_URI: optionalSecret,
  TOKEN_ENCRYPTION_KEY: optionalSecret,
  TOKEN_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  TOKEN_ENCRYPTION_PREVIOUS_KEYS: optionalSecret,
  APP_ACCESS_SECRET: optionalSecret,
  INITIAL_ADMIN_EMAIL: optionalSecret,
  NEXT_PUBLIC_SITE_URL: optionalSecret,
  NEXT_PUBLIC_SUPABASE_URL: optionalSecret,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  SUPABASE_STORAGE_BUCKET: optionalSecret,
  ASSET_CLEANUP_SECRET: optionalSecret,
  FACEBOOK_CRON_SECRET: optionalSecret,
  AI_PROVIDER_API_KEY: optionalSecret,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= serverEnvSchema.parse(process.env);
  return cachedEnv;
}

export function requireServerEnv<Key extends keyof ServerEnv>(
  key: Key,
): string {
  const value = getServerEnv()[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required server environment variable: ${key}`);
  }

  return value;
}

export const __testing = {
  reset() {
    cachedEnv = undefined;
  },
};
