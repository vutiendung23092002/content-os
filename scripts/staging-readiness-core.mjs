const requiredStagingVariables = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_GRAPH_API_VERSION",
  "FACEBOOK_USER_ACCESS_TOKEN",
  "FACEBOOK_CONNECT_APP_ID",
  "FACEBOOK_CONNECT_APP_SECRET",
  "HAN_CONTENT_COMPOSE_PROJECT",
  "HAN_CONTENT_ENV_FILE",
  "HAN_CONTENT_IMAGE",
  "HAN_CONTENT_PORT",
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
const expectedStagingOrigin = "https://staging-social.vutiendung.io.vn";

function value(env, name) {
  return env[name]?.trim();
}

function validateHttpsUrl(env, name, failures) {
  const configured = value(env, name);
  if (!configured) {
    failures.push({ code: `${name}_MISSING`, names: [name] });
    return;
  }

  try {
    const parsed = new URL(configured);
    if (parsed.username || parsed.password) {
      failures.push({ code: `${name}_CREDENTIALS_NOT_ALLOWED`, names: [name] });
    } else if (parsed.protocol !== "https:") {
      failures.push({ code: `${name}_NOT_HTTPS`, names: [name] });
    }
  } catch {
    failures.push({ code: `${name}_INVALID`, names: [name] });
  }
}

export function validateStagingEnvironment(env) {
  const failures = [];
  const missing = requiredStagingVariables.filter((name) => !value(env, name));
  if (missing.length > 0) {
    failures.push({ code: "STAGING_ENV_MISSING", names: missing });
  }

  if (value(env, "DEPLOYMENT_ENVIRONMENT") !== "staging") {
    failures.push({
      code: "DEPLOYMENT_ENVIRONMENT_NOT_STAGING",
      names: ["DEPLOYMENT_ENVIRONMENT"],
    });
  }

  if (value(env, "FACEBOOK_GRAPH_API_VERSION") !== "v26.0") {
    failures.push({
      code: "GRAPH_VERSION_NOT_PINNED",
      names: ["FACEBOOK_GRAPH_API_VERSION"],
    });
  }

  for (const name of ["ASSET_CLEANUP_SECRET", "FACEBOOK_CRON_SECRET"]) {
    const configured = value(env, name);
    if (configured && configured.length < 32) {
      failures.push({ code: "STAGING_SECRET_TOO_SHORT", names: [name] });
    }
  }

  validateHttpsUrl(env, "NEXT_PUBLIC_SITE_URL", failures);
  validateHttpsUrl(env, "STAGING_BASE_URL", failures);
  if (value(env, "FACEBOOK_CONNECT_REDIRECT_URI")) {
    validateHttpsUrl(env, "FACEBOOK_CONNECT_REDIRECT_URI", failures);
  }

  const siteUrl = value(env, "NEXT_PUBLIC_SITE_URL");
  const stagingBaseUrl = value(env, "STAGING_BASE_URL");
  const connectRedirectUri = value(env, "FACEBOOK_CONNECT_REDIRECT_URI");
  try {
    if (
      siteUrl &&
      stagingBaseUrl &&
      new URL(siteUrl).origin !== new URL(stagingBaseUrl).origin
    ) {
      failures.push({
        code: "STAGING_PUBLIC_ORIGIN_MISMATCH",
        names: ["NEXT_PUBLIC_SITE_URL", "STAGING_BASE_URL"],
      });
    }
    if (
      siteUrl &&
      connectRedirectUri &&
      (new URL(connectRedirectUri).origin !== new URL(siteUrl).origin ||
        new URL(connectRedirectUri).pathname !== "/api/facebook/callback" ||
        new URL(connectRedirectUri).search ||
        new URL(connectRedirectUri).hash)
    ) {
      failures.push({
        code: "FACEBOOK_CONNECT_REDIRECT_URI_MISMATCH",
        names: ["FACEBOOK_CONNECT_REDIRECT_URI", "NEXT_PUBLIC_SITE_URL"],
      });
    }
    if (
      siteUrl &&
      stagingBaseUrl &&
      (new URL(siteUrl).origin !== expectedStagingOrigin ||
        new URL(stagingBaseUrl).origin !== expectedStagingOrigin)
    ) {
      failures.push({
        code: "STAGING_EXPECTED_ORIGIN_MISMATCH",
        names: ["NEXT_PUBLIC_SITE_URL", "STAGING_BASE_URL"],
      });
    }
  } catch {
    // Individual URL failures above already provide the safe diagnostics.
  }

  if (
    value(env, "FACEBOOK_APP_ID") &&
    value(env, "FACEBOOK_APP_ID") === value(env, "FACEBOOK_CONNECT_APP_ID")
  ) {
    failures.push({
      code: "FACEBOOK_CONNECT_APP_NOT_DISTINCT",
      names: ["FACEBOOK_APP_ID", "FACEBOOK_CONNECT_APP_ID"],
    });
  }

  if (value(env, "HAN_CONTENT_ENV_FILE") !== ".env.staging") {
    failures.push({
      code: "STAGING_RUNTIME_ENV_FILE_INVALID",
      names: ["HAN_CONTENT_ENV_FILE"],
    });
  }
  if (value(env, "HAN_CONTENT_PORT") !== "3211") {
    failures.push({
      code: "STAGING_HOST_PORT_INVALID",
      names: ["HAN_CONTENT_PORT"],
    });
  }
  if (value(env, "HAN_CONTENT_COMPOSE_PROJECT") !== "han-content-os-staging") {
    failures.push({
      code: "STAGING_COMPOSE_PROJECT_INVALID",
      names: ["HAN_CONTENT_COMPOSE_PROJECT"],
    });
  }
  if (value(env, "HAN_CONTENT_IMAGE") !== "han-content-os:staging") {
    failures.push({
      code: "STAGING_IMAGE_INVALID",
      names: ["HAN_CONTENT_IMAGE"],
    });
  }

  if (value(env, "AI_PROVIDER_API_KEY")) {
    failures.push({
      code: "DEFERRED_AI_SECRET_MUST_BE_ABSENT",
      names: ["AI_PROVIDER_API_KEY"],
    });
  }

  return {
    ok: failures.length === 0,
    environment: "staging",
    checks: requiredStagingVariables.length + 14,
    failures,
  };
}

function parsePostgresUrl(env, name, failures) {
  const configured = value(env, name);
  if (!configured) {
    failures.push({ code: `${name}_MISSING`, names: [name] });
    return;
  }

  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      failures.push({ code: `${name}_INVALID`, names: [name] });
      return;
    }
    return parsed;
  } catch {
    failures.push({ code: `${name}_INVALID`, names: [name] });
  }
}

function databaseIdentity(url) {
  const port = url.port || "5432";
  return `${url.hostname.toLowerCase()}:${port}${url.pathname}`;
}

export function resolveRestoreVerificationEnvironment(env) {
  const failures = [];

  if (value(env, "DEPLOYMENT_ENVIRONMENT") !== "staging") {
    failures.push({
      code: "DEPLOYMENT_ENVIRONMENT_NOT_STAGING",
      names: ["DEPLOYMENT_ENVIRONMENT"],
    });
  }
  if (
    value(env, "CONFIRM_ISOLATED_RESTORE_TARGET") !== "isolated-staging-restore"
  ) {
    failures.push({
      code: "ISOLATED_RESTORE_CONFIRMATION_REQUIRED",
      names: ["CONFIRM_ISOLATED_RESTORE_TARGET"],
    });
  }

  const source = parsePostgresUrl(env, "STAGING_SOURCE_DATABASE_URL", failures);
  const target = parsePostgresUrl(
    env,
    "ISOLATED_RESTORE_DATABASE_URL",
    failures,
  );

  if (
    source &&
    target &&
    databaseIdentity(source) === databaseIdentity(target)
  ) {
    failures.push({
      code: "RESTORE_TARGET_MATCHES_SOURCE",
      names: ["STAGING_SOURCE_DATABASE_URL", "ISOLATED_RESTORE_DATABASE_URL"],
    });
  }

  if (failures.length > 0 || !target) {
    return { ok: false, failures };
  }

  const childEnvironment = { ...env };
  delete childEnvironment.STAGING_SOURCE_DATABASE_URL;
  delete childEnvironment.ISOLATED_RESTORE_DATABASE_URL;
  delete childEnvironment.CONFIRM_ISOLATED_RESTORE_TARGET;
  childEnvironment.DATABASE_URL = target.toString();
  childEnvironment.DIRECT_DATABASE_URL = target.toString();
  childEnvironment.DATABASE_VERIFICATION_EXPLICIT_ENV = "true";

  return {
    ok: true,
    failures: [],
    childEnvironment,
  };
}
