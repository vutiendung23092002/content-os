import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  authorizeRequestPostAccess: vi.fn(),
  assertMutationRateLimit: vi.fn(),
  reschedule: vi.fn(),
}));

vi.mock("@/lib/access/same-origin", () => ({
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/lib/access/page-access", () => ({
  authorizeRequestPostAccess: mocks.authorizeRequestPostAccess,
}));
vi.mock("@/lib/security/mutation-rate-limit", () => ({
  assertMutationRateLimit: mocks.assertMutationRateLimit,
}));
vi.mock("@/modules/posts/reschedule-post", () => ({
  ReschedulePostService: class {
    reschedule = mocks.reschedule;
  },
}));

import { PATCH } from "./route";

const postId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";
const scheduledFor = "2026-08-27T08:00:00.000Z";
const context = { params: Promise.resolve({ postId }) };

function request(body: unknown) {
  return new Request(`https://social.example/api/posts/${postId}/reschedule`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: {
      origin: "https://social.example",
      host: "social.example",
      "content-type": "application/json",
      "x-request-id": "reschedule-route-test",
    },
  });
}

describe("post reschedule API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRequestPostAccess.mockResolvedValue({
      post: { pageId: "018f0d44-35f0-7b63-99d2-c1b9222cd061" },
      viewer: { id: "viewer-1" },
    });
    mocks.assertMutationRateLimit.mockResolvedValue(undefined);
    mocks.reschedule.mockResolvedValue({
      operationId: "operation-1",
      postId,
      remotePostId: "remote-1",
      status: "scheduled",
      scheduledFor,
    });
  });

  it("checks same-origin and current Page access before rescheduling", async () => {
    const response = await PATCH(request({ scheduledFor }), context);

    expect(response.status).toBe(200);
    expect(mocks.assertSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.authorizeRequestPostAccess).toHaveBeenCalledWith(
      expect.any(Request),
      postId,
    );
    expect(mocks.assertMutationRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "post:reschedule" }),
    );
    expect(mocks.reschedule).toHaveBeenCalledWith(postId, scheduledFor);
  });

  it("rejects extra request fields before calling the use-case", async () => {
    const response = await PATCH(
      request({ scheduledFor, retryMutation: true }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before calling the use-case", async () => {
    const malformed = new Request(
      `https://social.example/api/posts/${postId}/reschedule`,
      {
        method: "PATCH",
        body: "{",
        headers: { "content-type": "application/json" },
      },
    );

    const response = await PATCH(malformed, context);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "MALFORMED_JSON" },
    });
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("rejects an oversized JSON body before calling the use-case", async () => {
    const oversized = request({
      scheduledFor,
      padding: "x".repeat(128 * 1024),
    });

    const response = await PATCH(oversized, context);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("returns 429 without calling the use-case when the limit is exceeded", async () => {
    mocks.assertMutationRateLimit.mockRejectedValueOnce(
      new AppError({
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many mutations",
        status: 429,
      }),
    );

    const response = await PATCH(request({ scheduledFor }), context);

    expect(response.status).toBe(429);
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });
});
