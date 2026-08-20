import { afterEach, describe, expect, it, vi } from "vitest";
import { __testing } from "@/lib/env/server";
import {
  assertInternalAccess,
  INTERNAL_ACCESS_HEADER,
} from "./internal-access";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...originalEnv };
  __testing.reset();
});

describe("internal access guard", () => {
  it("allows local development when no secret is configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.APP_ACCESS_SECRET;
    __testing.reset();

    expect(() =>
      assertInternalAccess(new Request("http://localhost/api/test")),
    ).not.toThrow();
  });

  it("requires the configured secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.APP_ACCESS_SECRET = "a-long-internal-secret";
    __testing.reset();

    const deniedRequest = new Request("https://example.com/api/test");
    expect(() => assertInternalAccess(deniedRequest)).toThrow(
      "Không có quyền truy cập",
    );

    const allowedRequest = new Request("https://example.com/api/test", {
      headers: { [INTERNAL_ACCESS_HEADER]: "a-long-internal-secret" },
    });
    expect(() => assertInternalAccess(allowedRequest)).not.toThrow();
  });
});
