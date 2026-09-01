import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseEnv } from "node:util";
import { validateStagingEnvironment } from "./staging-readiness-core.mjs";

export const projectEnvironmentNames = [
  "AI_PROVIDER_API_KEY",
  "APP_ACCESS_SECRET",
  "ASSET_CLEANUP_SECRET",
  "CLOUDFLARE_ACCESS_CLIENT_ID",
  "CLOUDFLARE_ACCESS_CLIENT_SECRET",
  "DATABASE_URL",
  "DEPLOYMENT_ENVIRONMENT",
  "DIRECT_DATABASE_URL",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_CAPABILITY_TEST_PAGE_ID",
  "FACEBOOK_CAPABILITY_TEST_PAGE_NAME",
  "FACEBOOK_CRON_BASE_URL",
  "FACEBOOK_CRON_SECRET",
  "FACEBOOK_GRAPH_API_VERSION",
  "FACEBOOK_USER_ACCESS_TOKEN",
  "HAN_CONTENT_COMPOSE_PROJECT",
  "HAN_CONTENT_ENV_FILE",
  "HAN_CONTENT_IMAGE",
  "HAN_CONTENT_PORT",
  "INITIAL_ADMIN_EMAIL",
  "LOG_LEVEL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "STAGING_BASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_KEY_VERSION",
  "TOKEN_ENCRYPTION_PREVIOUS_KEYS",
];

function safetyFailure(code, names = []) {
  return { code, names };
}

export function loadExplicitEnvironment(input) {
  const selectedPath = resolve(input.cwd, input.envFile);
  if (!existsSync(selectedPath)) {
    return {
      ok: false,
      failures: [safetyFailure("SELECTED_ENV_FILE_MISSING", ["envFile"])],
    };
  }

  let selected;
  try {
    selected = parseEnv(readFileSync(selectedPath, "utf8"));
  } catch {
    return {
      ok: false,
      failures: [safetyFailure("SELECTED_ENV_FILE_INVALID", ["envFile"])],
    };
  }

  const childEnvironment = { ...input.inheritedEnvironment };
  for (const name of projectEnvironmentNames) delete childEnvironment[name];
  Object.assign(childEnvironment, selected);
  childEnvironment.HAN_CONTENT_EXPLICIT_ENV = "true";
  childEnvironment.HAN_CONTENT_EXPLICIT_ENV_FILE = basename(selectedPath);
  childEnvironment.__NEXT_PROCESSED_ENV = "true";

  const failures = [];
  if (input.expect === "staging") {
    failures.push(...validateStagingEnvironment(childEnvironment).failures);
    if (childEnvironment.HAN_CONTENT_ENV_FILE !== basename(selectedPath)) {
      failures.push(
        safetyFailure("STAGING_RUNTIME_ENV_FILE_MISMATCH", [
          "HAN_CONTENT_ENV_FILE",
        ]),
      );
    }
  } else {
    if (childEnvironment.DEPLOYMENT_ENVIRONMENT === "staging") {
      failures.push(
        safetyFailure("PRODUCTION_ENVIRONMENT_MARKED_STAGING", [
          "DEPLOYMENT_ENVIRONMENT",
        ]),
      );
    }
    if (
      childEnvironment.HAN_CONTENT_ENV_FILE &&
      childEnvironment.HAN_CONTENT_ENV_FILE !== basename(selectedPath)
    ) {
      failures.push(
        safetyFailure("PRODUCTION_RUNTIME_ENV_FILE_MISMATCH", [
          "HAN_CONTENT_ENV_FILE",
        ]),
      );
    }
  }

  return failures.length > 0
    ? { ok: false, failures }
    : {
        ok: true,
        envFile: basename(selectedPath),
        childEnvironment,
      };
}

export function resolveComposeConfiguration(environment) {
  return {
    projectName: environment.HAN_CONTENT_COMPOSE_PROJECT || "han-content-os",
    image: environment.HAN_CONTENT_IMAGE || "han-content-os:local",
    envFile: environment.HAN_CONTENT_ENV_FILE || ".env.local",
    hostPort: environment.HAN_CONTENT_PORT || "3210",
  };
}

export function shouldLoadDefaultEnvironment(environment = process.env) {
  return (
    environment.HAN_CONTENT_EXPLICIT_ENV !== "true" &&
    environment.DATABASE_VERIFICATION_EXPLICIT_ENV !== "true"
  );
}
