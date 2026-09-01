import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";

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
