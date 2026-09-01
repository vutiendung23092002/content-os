import { runStagingAccessSmoke } from "./staging-access-smoke-core.mjs";

const baseUrlValue = process.env.STAGING_BASE_URL?.trim();
const cloudflareAccessClientId =
  process.env.CLOUDFLARE_ACCESS_CLIENT_ID?.trim();
const cloudflareAccessClientSecret =
  process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET?.trim();

process.exitCode = await runStagingAccessSmoke({
  deploymentEnvironment: process.env.DEPLOYMENT_ENVIRONMENT?.trim(),
  baseUrlValue,
  cloudflareAccessClientId,
  cloudflareAccessClientSecret,
});
