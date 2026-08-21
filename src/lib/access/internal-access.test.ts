import { afterEach, describe, expect, it, vi } from "vitest";
import { __testing } from "@/lib/env/server";
import {
  assertInternalAccess,
  hasConfiguredSecretAccess,
  INTERNAL_ACCESS_HEADER,
} from "./internal-access";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...originalEnv };
  __testing.reset();
});

describe("internal access guard", () => {
  it("does not treat an unconfigured request as secret access", () => {
    delete process.env.APP_ACCESS_SECRET;
    __testing.reset();
    expect(
      hasConfiguredSecretAccess(new Request("https://example.com/api/test")),
    ).toBe(false);
  });

  it("accepts the optional server automation header", async () => {
    vi.stubEnv("APP_ACCESS_SECRET", "a-long-internal-secret");
    __testing.reset();
    const request = new Request("https://example.com/api/test", {
      headers: { [INTERNAL_ACCESS_HEADER]: "a-long-internal-secret" },
    });
    await expect(assertInternalAccess(request)).resolves.toBeUndefined();
  });

  it("rejects an invalid automation secret without a Google session", async () => {
    vi.stubEnv("APP_ACCESS_SECRET", "a-long-internal-secret");
    __testing.reset();
    const request = new Request("https://example.com/api/test", {
      headers: { [INTERNAL_ACCESS_HEADER]: "wrong" },
    });
    await expect(assertInternalAccess(request)).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  });
});
