import { beforeEach, describe, expect, it, vi } from "vitest";
import { __testing as envTesting } from "@/lib/env/server";
import { AppError } from "@/lib/errors/app-error";
import {
  assertAssetCleanupAccess,
  assertFacebookCronAccess,
} from "./cron-access";

const secret = "asset-cleanup-secret-with-at-least-32-characters";

describe("asset cleanup cron access", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    envTesting.reset();
  });

  it("accepts the dedicated bearer secret", () => {
    vi.stubEnv("ASSET_CLEANUP_SECRET", secret);
    envTesting.reset();
    const request = new Request(
      "https://content.example.com/api/cron/assets/cleanup",
      {
        headers: { authorization: `Bearer ${secret}` },
      },
    );

    expect(() => assertAssetCleanupAccess(request)).not.toThrow();
  });

  it("rejects a wrong secret", () => {
    vi.stubEnv("ASSET_CLEANUP_SECRET", secret);
    envTesting.reset();
    const request = new Request(
      "https://content.example.com/api/cron/assets/cleanup",
      {
        headers: { authorization: "Bearer definitely-wrong" },
      },
    );

    try {
      assertAssetCleanupAccess(request);
      throw new Error("expected access rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "ASSET_CLEANUP_UNAUTHORIZED",
        status: 401,
      });
    }
  });

  it("fails closed when the configured secret is too short", () => {
    vi.stubEnv("ASSET_CLEANUP_SECRET", "too-short");
    envTesting.reset();
    const request = new Request(
      "https://content.example.com/api/cron/assets/cleanup",
    );

    expect(() => assertAssetCleanupAccess(request)).toThrow(
      "Asset cleanup secret phải có ít nhất 32 ký tự.",
    );
  });
});

describe("Facebook cron access", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    envTesting.reset();
  });

  it("accepts only the dedicated Facebook cron bearer secret", () => {
    vi.stubEnv("FACEBOOK_CRON_SECRET", secret);
    envTesting.reset();
    const request = new Request(
      "https://social.example.com/api/cron/sync-facebook",
      { headers: { authorization: `Bearer ${secret}` } },
    );

    expect(() => assertFacebookCronAccess(request)).not.toThrow();
  });

  it("does not accept the asset cleanup secret", () => {
    vi.stubEnv("FACEBOOK_CRON_SECRET", `${secret}-facebook`);
    vi.stubEnv("ASSET_CLEANUP_SECRET", secret);
    envTesting.reset();
    const request = new Request(
      "https://social.example.com/api/cron/reconcile-operations",
      { headers: { authorization: `Bearer ${secret}` } },
    );

    expect(() => assertFacebookCronAccess(request)).toThrow(
      "Không có quyền chạy facebook cron.",
    );
  });
});
