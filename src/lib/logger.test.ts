import { describe, expect, it } from "vitest";
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
