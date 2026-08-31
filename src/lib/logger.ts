import "server-only";
import pino from "pino";

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "authorization",
  "accessToken",
  "access_token",
  "pageAccessToken",
  "FACEBOOK_USER_ACCESS_TOKEN",
  "FACEBOOK_APP_SECRET",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_PREVIOUS_KEYS",
  "FACEBOOK_CRON_SECRET",
  "ASSET_CLEANUP_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  base: {
    service: "han-content-os",
  },
});
