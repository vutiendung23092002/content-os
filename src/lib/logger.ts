import "server-only";
import pino from "pino";

export const loggerRedactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "authorization",
  "accessToken",
  "access_token",
  "pageAccessToken",
  "FACEBOOK_USER_ACCESS_TOKEN",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_CONNECT_APP_SECRET",
  "authorizationCode",
  "oauth.code",
  "query.code",
  "req.query.code",
  "userAccessToken",
  "userTokenCiphertext",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_PREVIOUS_KEYS",
  "FACEBOOK_CRON_SECRET",
  "ASSET_CLEANUP_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLOUDFLARE_ACCESS_CLIENT_ID",
  "CLOUDFLARE_ACCESS_CLIENT_SECRET",
  "['CF-Access-Client-Id']",
  "['CF-Access-Client-Secret']",
  "headers['cf-access-client-id']",
  "headers['cf-access-client-secret']",
  "req.headers['cf-access-client-id']",
  "req.headers['cf-access-client-secret']",
];

export const logger = pino({
  level: process.env.LOG_LEVEL?.trim() || "info",
  redact: {
    paths: loggerRedactPaths,
    censor: "[REDACTED]",
  },
  base: {
    service: "han-content-os",
  },
});
