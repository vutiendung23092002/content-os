import { afterEach, describe, expect, it } from "vitest";
import { __testing, getServerEnv, requireServerEnv } from "./server";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  __testing.reset();
});

describe("server environment", () => {
  it("allows optional provider configuration during foundation builds", () => {
    delete process.env.DATABASE_URL;
    expect(getServerEnv().DATABASE_URL).toBeUndefined();
  });

  it("normalizes blank optional secrets to undefined", () => {
    process.env.FACEBOOK_APP_SECRET = "   ";
    expect(getServerEnv().FACEBOOK_APP_SECRET).toBeUndefined();
  });

  it("fails only when a feature requires a missing secret", () => {
    delete process.env.FACEBOOK_USER_ACCESS_TOKEN;
    expect(() => requireServerEnv("FACEBOOK_USER_ACCESS_TOKEN")).toThrow(
      "Missing required server environment variable",
    );
  });
});
