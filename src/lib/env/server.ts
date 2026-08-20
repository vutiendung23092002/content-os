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
  TOKEN_ENCRYPTION_KEY: optionalSecret,
  APP_ACCESS_SECRET: optionalSecret,
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
