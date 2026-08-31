const required = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_GRAPH_API_VERSION",
  "FACEBOOK_USER_ACCESS_TOKEN",
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_KEY_VERSION",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "ASSET_CLEANUP_SECRET",
  "FACEBOOK_CRON_SECRET",
  "NEXT_PUBLIC_SITE_URL",
  "INITIAL_ADMIN_EMAIL",
  "FACEBOOK_CAPABILITY_TEST_PAGE_ID",
  "FACEBOOK_CAPABILITY_TEST_PAGE_NAME",
];

const failures = [];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  failures.push({ code: "STAGING_ENV_MISSING", names: missing });
}

if (process.env.DEPLOYMENT_ENVIRONMENT?.trim() !== "staging") {
  failures.push({
    code: "DEPLOYMENT_ENVIRONMENT_NOT_STAGING",
    names: ["DEPLOYMENT_ENVIRONMENT"],
  });
}

if (process.env.FACEBOOK_GRAPH_API_VERSION?.trim() !== "v26.0") {
  failures.push({
    code: "GRAPH_VERSION_NOT_PINNED",
    names: ["FACEBOOK_GRAPH_API_VERSION"],
  });
}

for (const name of ["ASSET_CLEANUP_SECRET", "FACEBOOK_CRON_SECRET"]) {
  const value = process.env[name]?.trim();
  if (value && value.length < 32) {
    failures.push({ code: "STAGING_SECRET_TOO_SHORT", names: [name] });
  }
}

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
if (siteUrl) {
  try {
    const parsed = new URL(siteUrl);
    if (parsed.protocol !== "https:") {
      failures.push({
        code: "STAGING_SITE_URL_NOT_HTTPS",
        names: ["NEXT_PUBLIC_SITE_URL"],
      });
    }
  } catch {
    failures.push({
      code: "STAGING_SITE_URL_INVALID",
      names: ["NEXT_PUBLIC_SITE_URL"],
    });
  }
}

if (process.env.AI_PROVIDER_API_KEY?.trim()) {
  failures.push({
    code: "DEFERRED_AI_SECRET_MUST_BE_ABSENT",
    names: ["AI_PROVIDER_API_KEY"],
  });
}

console.log(
  JSON.stringify({
    ok: failures.length === 0,
    environment: "staging",
    checks: required.length + 5,
    failures,
  }),
);

if (failures.length > 0) process.exitCode = 1;
