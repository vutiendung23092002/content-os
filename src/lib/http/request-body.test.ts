import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";
import { parseJsonBody } from "./request-body";

const schema = z.object({ value: z.string() }).strict();

function jsonRequest(body: string) {
  return new Request("https://social.example/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("bounded JSON request bodies", () => {
  it("parses a valid strict payload", async () => {
    await expect(
      parseJsonBody(jsonRequest('{"value":"ok"}'), schema),
    ).resolves.toEqual({ value: "ok" });
  });

  it("rejects a body that exceeds the raw byte limit", async () => {
    await expect(
      parseJsonBody(jsonRequest('{"value":"oversized"}'), schema, 8),
    ).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    } satisfies Partial<AppError>);
  });

  it("rejects malformed JSON with a stable client error", async () => {
    await expect(parseJsonBody(jsonRequest("{"), schema)).rejects.toMatchObject(
      {
        code: "MALFORMED_JSON",
        status: 400,
      } satisfies Partial<AppError>,
    );
  });

  it("rejects unknown fields through the strict schema", async () => {
    await expect(
      parseJsonBody(jsonRequest('{"value":"ok","extra":true}'), schema),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});
