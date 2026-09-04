import { describe, expect, it } from "vitest";
import {
  resolveRestoreVerificationEnvironment,
  validateStagingEnvironment,
} from "./staging-readiness-core.mjs";

function databaseUrl(user: string, host: string, database: string): string {
  return `postgresql:${"//"}${user}:test-secret@${host}/${database}`;
}

function validStagingEnvironment(): NodeJS.ProcessEnv {
  return {
    DEPLOYMENT_ENVIRONMENT: "staging",
    STAGING_BASE_URL: "https://staging-social.vutiendung.io.vn",
    HAN_CONTENT_COMPOSE_PROJECT: "han-content-os-staging",
    HAN_CONTENT_IMAGE: "han-content-os:staging",
    HAN_CONTENT_ENV_FILE: ".env.staging",
    HAN_CONTENT_PORT: "3211",
    DATABASE_URL: databaseUrl("runtime", "staging-db.test", "app"),
    DIRECT_DATABASE_URL: databaseUrl("migration", "staging-db.test", "app"),
    FACEBOOK_APP_ID: "test-app-id",
    FACEBOOK_APP_SECRET: "test-app-secret",
    FACEBOOK_GRAPH_API_VERSION: "v26.0",
    FACEBOOK_USER_ACCESS_TOKEN: "test-user-token",
    FACEBOOK_CONNECT_APP_ID: "test-connect-app-id",
    FACEBOOK_CONNECT_APP_SECRET: "test-connect-app-secret",
    FACEBOOK_CONNECT_REDIRECT_URI:
      "https://staging-social.vutiendung.io.vn/api/facebook/callback",
    TOKEN_ENCRYPTION_KEY: "test-encryption-key",
    TOKEN_ENCRYPTION_KEY_VERSION: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://staging-supabase.example.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    SUPABASE_STORAGE_BUCKET: "test-assets",
    ASSET_CLEANUP_SECRET: "a".repeat(32),
    FACEBOOK_CRON_SECRET: "b".repeat(32),
    NEXT_PUBLIC_SITE_URL: "https://staging-social.vutiendung.io.vn",
    INITIAL_ADMIN_EMAIL: "admin@example.test",
    FACEBOOK_CAPABILITY_TEST_PAGE_ID: "test-page-id",
    FACEBOOK_CAPABILITY_TEST_PAGE_NAME: "Test Page",
  };
}

describe("staging environment URL validation", () => {
  it("rejects a missing STAGING_BASE_URL", () => {
    const env = validStagingEnvironment();
    delete env.STAGING_BASE_URL;

    expect(validateStagingEnvironment(env)).toMatchObject({
      ok: false,
      failures: [
        expect.objectContaining({
          code: "STAGING_BASE_URL_MISSING",
          names: ["STAGING_BASE_URL"],
        }),
      ],
    });
  });

  it("rejects an invalid STAGING_BASE_URL without exposing its value", () => {
    const env = validStagingEnvironment();
    env.STAGING_BASE_URL = "not-a-url-with-secret-material";

    const result = validateStagingEnvironment(env);

    expect(result.failures).toContainEqual({
      code: "STAGING_BASE_URL_INVALID",
      names: ["STAGING_BASE_URL"],
    });
    expect(JSON.stringify(result)).not.toContain(env.STAGING_BASE_URL);
  });

  it("rejects an HTTP staging URL", () => {
    const env = validStagingEnvironment();
    env.STAGING_BASE_URL = "http://staging.example.test";

    expect(validateStagingEnvironment(env).failures).toContainEqual({
      code: "STAGING_BASE_URL_NOT_HTTPS",
      names: ["STAGING_BASE_URL"],
    });
  });

  it("accepts a valid HTTPS staging URL", () => {
    expect(validateStagingEnvironment(validStagingEnvironment())).toMatchObject(
      {
        ok: true,
        failures: [],
      },
    );
  });

  it("derives a missing App B callback and validates an explicit callback", () => {
    const missing = validStagingEnvironment();
    delete missing.FACEBOOK_CONNECT_REDIRECT_URI;
    expect(validateStagingEnvironment(missing)).toMatchObject({
      ok: true,
      failures: [],
    });

    const http = validStagingEnvironment();
    http.FACEBOOK_CONNECT_REDIRECT_URI =
      "http://staging-social.vutiendung.io.vn/api/facebook/callback";
    expect(validateStagingEnvironment(http).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "FACEBOOK_CONNECT_REDIRECT_URI_NOT_HTTPS",
        }),
      ]),
    );

    const wrongPath = validStagingEnvironment();
    wrongPath.FACEBOOK_CONNECT_REDIRECT_URI =
      "https://staging-social.vutiendung.io.vn/wrong";
    expect(validateStagingEnvironment(wrongPath).failures).toContainEqual({
      code: "FACEBOOK_CONNECT_REDIRECT_URI_MISMATCH",
      names: ["FACEBOOK_CONNECT_REDIRECT_URI", "NEXT_PUBLIC_SITE_URL"],
    });

    const query = validStagingEnvironment();
    query.FACEBOOK_CONNECT_REDIRECT_URI =
      "https://staging-social.vutiendung.io.vn/api/facebook/callback?unsafe=1";
    expect(validateStagingEnvironment(query).failures).toContainEqual({
      code: "FACEBOOK_CONNECT_REDIRECT_URI_MISMATCH",
      names: ["FACEBOOK_CONNECT_REDIRECT_URI", "NEXT_PUBLIC_SITE_URL"],
    });
  });

  it("requires App B to be distinct from the admin-managed Meta App", () => {
    const env = validStagingEnvironment();
    env.FACEBOOK_CONNECT_APP_ID = env.FACEBOOK_APP_ID;

    expect(validateStagingEnvironment(env).failures).toContainEqual({
      code: "FACEBOOK_CONNECT_APP_NOT_DISTINCT",
      names: ["FACEBOOK_APP_ID", "FACEBOOK_CONNECT_APP_ID"],
    });
  });

  it("rejects production Compose and image identities", () => {
    const env = validStagingEnvironment();
    env.HAN_CONTENT_COMPOSE_PROJECT = "han-content-os-prod";
    env.HAN_CONTENT_IMAGE = "han-content-os:prod";

    expect(validateStagingEnvironment(env).failures).toEqual(
      expect.arrayContaining([
        {
          code: "STAGING_COMPOSE_PROJECT_INVALID",
          names: ["HAN_CONTENT_COMPOSE_PROJECT"],
        },
        {
          code: "STAGING_IMAGE_INVALID",
          names: ["HAN_CONTENT_IMAGE"],
        },
      ]),
    );
  });

  it("rejects a matching pair of URLs on the wrong public origin", () => {
    const env = validStagingEnvironment();
    env.STAGING_BASE_URL = "https://social.vutiendung.io.vn";
    env.NEXT_PUBLIC_SITE_URL = "https://social.vutiendung.io.vn";

    expect(validateStagingEnvironment(env).failures).toContainEqual({
      code: "STAGING_EXPECTED_ORIGIN_MISMATCH",
      names: ["NEXT_PUBLIC_SITE_URL", "STAGING_BASE_URL"],
    });
  });
});

describe("isolated restore database verification guard", () => {
  const restoreEnvironment = {
    DEPLOYMENT_ENVIRONMENT: "staging",
    CONFIRM_ISOLATED_RESTORE_TARGET: "isolated-staging-restore",
    STAGING_SOURCE_DATABASE_URL: databaseUrl(
      "source",
      "staging-db.test",
      "source",
    ),
    ISOLATED_RESTORE_DATABASE_URL: databaseUrl(
      "restore",
      "isolated-db.test",
      "restored",
    ),
    DATABASE_URL: databaseUrl("wrong", "fallback.test", "wrong"),
    DIRECT_DATABASE_URL: databaseUrl("wrong", "fallback.test", "wrong"),
  };

  it("fails closed when the isolated restore target is missing", () => {
    const env = { ...restoreEnvironment };
    delete (env as Partial<typeof env>).ISOLATED_RESTORE_DATABASE_URL;

    expect(resolveRestoreVerificationEnvironment(env)).toMatchObject({
      ok: false,
      failures: [
        expect.objectContaining({
          code: "ISOLATED_RESTORE_DATABASE_URL_MISSING",
        }),
      ],
    });
  });

  it("requires explicit isolated-target confirmation", () => {
    const env = { ...restoreEnvironment };
    delete (env as Partial<typeof env>).CONFIRM_ISOLATED_RESTORE_TARGET;

    expect(resolveRestoreVerificationEnvironment(env)).toMatchObject({
      ok: false,
      failures: [
        expect.objectContaining({
          code: "ISOLATED_RESTORE_CONFIRMATION_REQUIRED",
        }),
      ],
    });
  });

  it("rejects a restore target that identifies the source database", () => {
    const env = {
      ...restoreEnvironment,
      ISOLATED_RESTORE_DATABASE_URL: databaseUrl(
        "different-user",
        "staging-db.test",
        "source",
      ),
    };

    expect(resolveRestoreVerificationEnvironment(env)).toMatchObject({
      ok: false,
      failures: [
        expect.objectContaining({ code: "RESTORE_TARGET_MATCHES_SOURCE" }),
      ],
    });
  });

  it("pins both schema and integration-test URLs to the isolated target", () => {
    const result = resolveRestoreVerificationEnvironment(restoreEnvironment);

    expect(result).toMatchObject({ ok: true, failures: [] });
    if (!result.ok) throw new Error("expected a valid restore target");
    expect(result.childEnvironment.DATABASE_URL).toBe(
      restoreEnvironment.ISOLATED_RESTORE_DATABASE_URL,
    );
    expect(result.childEnvironment.DIRECT_DATABASE_URL).toBe(
      restoreEnvironment.ISOLATED_RESTORE_DATABASE_URL,
    );
    expect(result.childEnvironment.DATABASE_VERIFICATION_EXPLICIT_ENV).toBe(
      "true",
    );
    expect(result.childEnvironment).not.toHaveProperty(
      "STAGING_SOURCE_DATABASE_URL",
    );
    expect(result.childEnvironment).not.toHaveProperty(
      "ISOLATED_RESTORE_DATABASE_URL",
    );
  });
});
