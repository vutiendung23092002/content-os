import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toErrorResponse } from "./api-error";

describe("toErrorResponse", () => {
  it("maps validation details to a safe 400 response", async () => {
    let error: unknown;
    try {
      z.object({ pageId: z.uuid() }).parse({ pageId: "not-a-uuid" });
    } catch (caught) {
      error = caught;
    }

    const response = toErrorResponse(error, "request-1");
    const payload = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };

    expect(response.status).toBe(400);
    expect(payload.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "Dữ liệu gửi lên không hợp lệ.",
      requestId: "request-1",
      retryable: false,
    });
    expect(JSON.stringify(payload)).not.toContain("not-a-uuid");
  });
});
