const serviceTokenNames = [
  "CLOUDFLARE_ACCESS_CLIENT_ID",
  "CLOUDFLARE_ACCESS_CLIENT_SECRET",
];

function writeJson(writer, value) {
  writer(JSON.stringify(value));
}

export async function runStagingAccessSmoke({
  deploymentEnvironment,
  baseUrlValue,
  cloudflareAccessClientId,
  cloudflareAccessClientSecret,
  fetchImpl = fetch,
  writeOutput = console.log,
  writeError = console.error,
}) {
  if (deploymentEnvironment !== "staging") {
    writeJson(writeError, {
      ok: false,
      code: "STAGING_ENVIRONMENT_REQUIRED",
    });
    return 1;
  }

  if (!baseUrlValue) {
    writeJson(writeError, { ok: false, code: "STAGING_BASE_URL_MISSING" });
    return 1;
  }

  let baseUrl;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    writeJson(writeError, { ok: false, code: "STAGING_BASE_URL_INVALID" });
    return 1;
  }

  if (baseUrl.protocol !== "https:") {
    writeJson(writeError, {
      ok: false,
      code: "STAGING_BASE_URL_MUST_USE_HTTPS",
    });
    return 1;
  }

  const missingServiceTokenNames = serviceTokenNames.filter((name) =>
    name === "CLOUDFLARE_ACCESS_CLIENT_ID"
      ? !cloudflareAccessClientId
      : !cloudflareAccessClientSecret,
  );
  if (missingServiceTokenNames.length > 0) {
    writeJson(writeError, {
      ok: false,
      code: "CLOUDFLARE_ACCESS_SERVICE_TOKEN_MISSING",
      names: missingServiceTokenNames,
    });
    return 1;
  }

  const failures = [];
  const checks = [];
  const accessHeaders = {
    "CF-Access-Client-Id": cloudflareAccessClientId,
    "CF-Access-Client-Secret": cloudflareAccessClientSecret,
  };

  async function check(name, path, expected) {
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        headers: accessHeaders,
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
  await check("protected_page", "/posts", (response) => {
    if (response.status < 300 || response.status >= 400) return false;
    const location = response.headers.get("location");
    if (!location) return false;

    try {
      const redirectTarget = new URL(location, baseUrl);
      return (
        redirectTarget.origin === baseUrl.origin &&
        redirectTarget.pathname === "/login"
      );
    } catch {
      return false;
    }
  });
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

  writeJson(writeOutput, {
    ok: failures.length === 0,
    checks,
    failures,
  });
  return failures.length > 0 ? 1 : 0;
}
