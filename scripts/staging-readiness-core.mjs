const requiredStagingVariables = [
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

  if (value(env, "AI_PROVIDER_API_KEY")) {
    failures.push({
      code: "DEFERRED_AI_SECRET_MUST_BE_ABSENT",
      names: ["AI_PROVIDER_API_KEY"],
    });
  }

  return {
    ok: failures.length === 0,
    environment: "staging",
    checks: requiredStagingVariables.length + 7,
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
