import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  assertRequestPostAccess: vi.fn(),
  reschedule: vi.fn(),
}));

vi.mock("@/lib/access/same-origin", () => ({
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/lib/access/page-access", () => ({
  assertRequestPostAccess: mocks.assertRequestPostAccess,
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
    mocks.assertRequestPostAccess.mockResolvedValue({ id: "viewer-1" });
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
    expect(mocks.assertRequestPostAccess).toHaveBeenCalledWith(
      expect.any(Request),
      postId,
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
});
