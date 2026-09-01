import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import { loggerRedactPaths } from "./logger";

describe("logger redaction contract", () => {
  it("redacts credential-shaped fields", async () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const testLogger = pino(
      { redact: { paths: ["accessToken"], censor: "[REDACTED]" } },
      destination,
    );

    testLogger.info({ accessToken: "secret-token", pageId: "page-1" }, "test");

    expect(output).not.toContain("secret-token");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("page-1");
  });

  it("redacts Cloudflare Access credentials at logging boundaries", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const testLogger = pino(
      { redact: { paths: loggerRedactPaths, censor: "[REDACTED]" } },
      destination,
    );

    testLogger.info({
      CLOUDFLARE_ACCESS_CLIENT_ID: "cloudflare-client-id-value",
      CLOUDFLARE_ACCESS_CLIENT_SECRET: "cloudflare-client-secret-value",
      "CF-Access-Client-Id": "cloudflare-header-id-value",
      "CF-Access-Client-Secret": "cloudflare-header-secret-value",
      headers: {
        "cf-access-client-id": "nested-client-id-value",
        "cf-access-client-secret": "nested-client-secret-value",
      },
    });

    expect(output).not.toContain("cloudflare-client-id-value");
    expect(output).not.toContain("cloudflare-client-secret-value");
    expect(output).not.toContain("cloudflare-header-id-value");
    expect(output).not.toContain("cloudflare-header-secret-value");
    expect(output).not.toContain("nested-client-id-value");
    expect(output).not.toContain("nested-client-secret-value");
    expect(output).toContain("[REDACTED]");
  });
});

describe("logger configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses info when LOG_LEVEL is blank", async () => {
    vi.stubEnv("LOG_LEVEL", "   ");
    vi.resetModules();

    const { logger } = await import("./logger");

    expect(logger.level).toBe("info");
  });
});
