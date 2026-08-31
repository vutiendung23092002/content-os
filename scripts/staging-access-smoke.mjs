const baseUrlValue = process.env.STAGING_BASE_URL?.trim();
const failures = [];
const checks = [];

if (process.env.DEPLOYMENT_ENVIRONMENT?.trim() !== "staging") {
  console.error(
    JSON.stringify({ ok: false, code: "STAGING_ENVIRONMENT_REQUIRED" }),
  );
  process.exit(1);
}

if (!baseUrlValue) {
  console.error(
    JSON.stringify({ ok: false, code: "STAGING_BASE_URL_MISSING" }),
  );
  process.exit(1);
}

const baseUrl = new URL(baseUrlValue);
if (baseUrl.protocol !== "https:") {
  console.error(
    JSON.stringify({ ok: false, code: "STAGING_BASE_URL_MUST_USE_HTTPS" }),
  );
  process.exit(1);
}

async function check(name, path, expected) {
  try {
    const response = await fetch(new URL(path, baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const passed = expected(response);
    checks.push({ name, status: response.status, passed });
    if (!passed) failures.push(name);
  } catch {
    checks.push({ name, status: null, passed: false });
    failures.push(name);
  }
}

await check("health", "/api/health", (response) => response.status === 200);
await check(
  "protected_page",
  "/posts",
  (response) =>
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.get("location")?.includes("/login") === true,
);
await check(
  "protected_api",
  "/api/pages",
  (response) => response.status === 401,
);
await check(
  "admin_api",
  "/api/admin/users",
  (response) => response.status === 401,
);
await check(
  "facebook_cron",
  "/api/cron/sync-facebook",
  (response) => response.status === 401,
);
await check(
  "asset_cleanup_cron",
  "/api/cron/assets/cleanup",
  (response) => response.status === 401,
);
await check(
  "legacy_password_endpoint",
  "/api/auth/internal/login",
  (response) => response.status === 404,
);

console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }));
if (failures.length > 0) process.exitCode = 1;
