import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadExplicitEnvironment,
  resolveComposeConfiguration,
  shouldLoadDefaultEnvironment,
} from "./explicit-environment.mjs";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "han-content-env-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function stagingValues(): Record<string, string> {
  return {
    DEPLOYMENT_ENVIRONMENT: "staging",
    STAGING_BASE_URL: "https://staging-social.vutiendung.io.vn",
    HAN_CONTENT_COMPOSE_PROJECT: "han-content-os-staging",
    HAN_CONTENT_IMAGE: "han-content-os:staging",
    HAN_CONTENT_ENV_FILE: ".env.staging",
    HAN_CONTENT_PORT: "3211",
    DATABASE_URL: "staging-runtime-database",
    DIRECT_DATABASE_URL: "staging-migration-database",
    FACEBOOK_APP_ID: "staging-app-id",
    FACEBOOK_APP_SECRET: "staging-app-secret",
    FACEBOOK_GRAPH_API_VERSION: "v26.0",
    FACEBOOK_USER_ACCESS_TOKEN: "staging-user-token",
    TOKEN_ENCRYPTION_KEY: "staging-encryption-key",
    TOKEN_ENCRYPTION_KEY_VERSION: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://staging-supabase.example.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "staging-publishable-key",
    SUPABASE_SERVICE_ROLE_KEY: "staging-service-role-key",
    SUPABASE_STORAGE_BUCKET: "staging-assets",
    ASSET_CLEANUP_SECRET: "a".repeat(32),
    FACEBOOK_CRON_SECRET: "b".repeat(32),
    NEXT_PUBLIC_SITE_URL: "https://staging-social.vutiendung.io.vn",
    INITIAL_ADMIN_EMAIL: "staging-admin@example.test",
    FACEBOOK_CAPABILITY_TEST_PAGE_ID: "test-page-id",
    FACEBOOK_CAPABILITY_TEST_PAGE_NAME: "Test Page",
  };
}

function writeEnvironment(
  directory: string,
  filename: string,
  values: Record<string, string>,
): void {
  writeFileSync(
    join(directory, filename),
    `${Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("explicit environment selection", () => {
  it("does not fill a missing staging variable from .env.local or inherited env", () => {
    const directory = temporaryDirectory();
    writeEnvironment(directory, ".env.local", {
      FACEBOOK_APP_SECRET: "production-secret-must-not-cross",
    });
    const staging = stagingValues();
    delete staging.FACEBOOK_APP_SECRET;
    writeEnvironment(directory, ".env.staging", staging);

    const result = loadExplicitEnvironment({
      cwd: directory,
      envFile: ".env.staging",
      expect: "staging",
      inheritedEnvironment: {
        FACEBOOK_APP_SECRET: "inherited-production-secret",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      failures: [
        expect.objectContaining({
          code: "STAGING_ENV_MISSING",
          names: expect.arrayContaining(["FACEBOOK_APP_SECRET"]),
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("production-secret");
  });

  it("lets selected staging values override inherited production values", () => {
    const directory = temporaryDirectory();
    writeEnvironment(directory, ".env.staging", stagingValues());

    const result = loadExplicitEnvironment({
      cwd: directory,
      envFile: ".env.staging",
      expect: "staging",
      inheritedEnvironment: {
        DATABASE_URL: "inherited-production-database",
        NEXT_PUBLIC_SITE_URL: "https://production.example.test",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected staging environment to pass");
    expect(result.childEnvironment.DATABASE_URL).toBe(
      "staging-runtime-database",
    );
    expect(result.childEnvironment.NEXT_PUBLIC_SITE_URL).toBe(
      "https://staging-social.vutiendung.io.vn",
    );
    expect(result.childEnvironment.HAN_CONTENT_EXPLICIT_ENV).toBe("true");
    expect(result.childEnvironment.__NEXT_PROCESSED_ENV).toBe("true");
  });

  it("replaces inherited Cloudflare Access credentials with selected values", () => {
    const directory = temporaryDirectory();
    writeEnvironment(directory, ".env.staging", {
      ...stagingValues(),
      CLOUDFLARE_ACCESS_CLIENT_ID: "selected-client-id",
      CLOUDFLARE_ACCESS_CLIENT_SECRET: "selected-client-secret",
    });

    const result = loadExplicitEnvironment({
      cwd: directory,
      envFile: ".env.staging",
      expect: "staging",
      inheritedEnvironment: {
        CLOUDFLARE_ACCESS_CLIENT_ID: "inherited-client-id",
        CLOUDFLARE_ACCESS_CLIENT_SECRET: "inherited-client-secret",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected staging environment to pass");
    expect(result.childEnvironment.CLOUDFLARE_ACCESS_CLIENT_ID).toBe(
      "selected-client-id",
    );
    expect(result.childEnvironment.CLOUDFLARE_ACCESS_CLIENT_SECRET).toBe(
      "selected-client-secret",
    );
  });

  it("does not borrow missing Cloudflare Access credentials from inherited env", () => {
    const directory = temporaryDirectory();
    writeEnvironment(directory, ".env.staging", stagingValues());

    const result = loadExplicitEnvironment({
      cwd: directory,
      envFile: ".env.staging",
      expect: "staging",
      inheritedEnvironment: {
        CLOUDFLARE_ACCESS_CLIENT_ID: "inherited-client-id-must-not-cross",
        CLOUDFLARE_ACCESS_CLIENT_SECRET:
          "inherited-client-secret-must-not-cross",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected staging environment to pass");
    expect(result.childEnvironment.CLOUDFLARE_ACCESS_CLIENT_ID).toBeUndefined();
    expect(
      result.childEnvironment.CLOUDFLARE_ACCESS_CLIENT_SECRET,
    ).toBeUndefined();
    expect(result.failures).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(
      "inherited-client-id-must-not-cross",
    );
    expect(JSON.stringify(result)).not.toContain(
      "inherited-client-secret-must-not-cross",
    );
  });

  it("blocks default env loading for explicit selection and restore verification", () => {
    expect(shouldLoadDefaultEnvironment({})).toBe(true);
    expect(
      shouldLoadDefaultEnvironment({ HAN_CONTENT_EXPLICIT_ENV: "true" }),
    ).toBe(false);
    expect(
      shouldLoadDefaultEnvironment({
        DATABASE_VERIFICATION_EXPLICIT_ENV: "true",
      }),
    ).toBe(false);
  });

  it("prevents downstream @next/env from loading .env.local", () => {
    const directory = temporaryDirectory();
    writeEnvironment(directory, ".env.local", {
      FACEBOOK_APP_SECRET: "must-not-be-loaded",
    });
    writeEnvironment(directory, ".env.staging", stagingValues());

    const selected = loadExplicitEnvironment({
      cwd: directory,
      envFile: ".env.staging",
      expect: "staging",
      inheritedEnvironment: {},
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error("expected staging environment to pass");
    delete selected.childEnvironment.FACEBOOK_APP_SECRET;

    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "const {loadEnvConfig}=require('@next/env'); loadEnvConfig(process.argv[1]); process.stdout.write(String(Boolean(process.env.FACEBOOK_APP_SECRET)));",
        directory,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: selected.childEnvironment,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("false");
    expect(result.stderr).not.toContain("must-not-be-loaded");
  });

  it("preserves production-compatible Compose defaults", () => {
    const directory = temporaryDirectory();
    writeEnvironment(directory, ".env.local", {
      DATABASE_URL: "production-runtime-database",
    });

    const selected = loadExplicitEnvironment({
      cwd: directory,
      envFile: ".env.local",
      expect: "production",
      inheritedEnvironment: {},
    });

    expect(selected.ok).toBe(true);
    if (!selected.ok)
      throw new Error("expected production environment to pass");
    expect(resolveComposeConfiguration(selected.childEnvironment)).toEqual({
      projectName: "han-content-os",
      image: "han-content-os:local",
      envFile: ".env.local",
      hostPort: "3210",
    });
  });

  it("resolves production and staging to isolated Compose identities", () => {
    const production = resolveComposeConfiguration({
      HAN_CONTENT_COMPOSE_PROJECT: "han-content-os-prod",
      HAN_CONTENT_IMAGE: "han-content-os:prod",
      HAN_CONTENT_ENV_FILE: ".env.local",
      HAN_CONTENT_PORT: "3210",
    });
    const staging = resolveComposeConfiguration(stagingValues());

    expect(staging.projectName).not.toBe(production.projectName);
    expect(staging.image).not.toBe(production.image);
    expect(staging.hostPort).not.toBe(production.hostPort);
    expect(staging.envFile).not.toBe(production.envFile);

    const compose = readFileSync(join(process.cwd(), "compose.yaml"), "utf8");
    expect(compose).toContain("${HAN_CONTENT_COMPOSE_PROJECT:-han-content-os}");
    expect(compose).toContain("${HAN_CONTENT_IMAGE:-han-content-os:local}");
    expect(compose).toContain("${HAN_CONTENT_ENV_FILE:-.env.local}");
    expect(compose).toContain("127.0.0.1:${HAN_CONTENT_PORT:-3210}:3000");
  });

  it("keeps staging package commands pinned to .env.staging", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const stagingCommands = Object.entries(packageJson.scripts).filter(
      ([name]) =>
        name.endsWith(":staging") ||
        name === "staging:env-check" ||
        name === "staging:access-smoke",
    );

    expect(stagingCommands.length).toBeGreaterThan(0);
    for (const [, command] of stagingCommands) {
      expect(command).toContain(
        "run-with-env.mjs .env.staging --expect=staging",
      );
      expect(command).not.toContain(".env.local");
    }
  });
});
