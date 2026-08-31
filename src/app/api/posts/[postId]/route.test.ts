import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({
  authorizeRequestPostAccess: vi.fn(),
  assertSameOrigin: vi.fn(),
  deleteDraft: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock("@/lib/access/page-access", () => ({
  assertRequestPostAccess: vi.fn(),
  authorizeRequestPostAccess: mocks.authorizeRequestPostAccess,
}));
vi.mock("@/lib/access/same-origin", () => ({
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/modules/posts/create-draft-service", () => ({
  createDraftService: () => ({
    delete: mocks.deleteDraft,
    update: mocks.updateDraft,
  }),
}));
vi.mock("@/modules/posts/draft-service", () => ({
  toDraftDto: vi.fn(),
}));

import { DELETE, PATCH } from "./route";

const postId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";
const context = { params: Promise.resolve({ postId }) };

describe("draft mutation route security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertSameOrigin.mockImplementation(() => {
      throw new AppError({
        code: "ORIGIN_REQUIRED",
        message: "Nguồn yêu cầu không hợp lệ.",
        status: 403,
      });
    });
  });

  it.each([
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ] as const)(
    "rejects %s before authorization or persistence",
    async (method, handler) => {
      const response = await handler(
        new Request(`https://social.example/api/posts/${postId}`, {
          method,
          ...(method === "PATCH"
            ? {
                body: JSON.stringify({ message: "Updated" }),
                headers: { "content-type": "application/json" },
              }
            : {}),
        }),
        context,
      );

      expect(response.status).toBe(403);
      expect(mocks.assertSameOrigin).toHaveBeenCalledOnce();
      expect(mocks.authorizeRequestPostAccess).not.toHaveBeenCalled();
      expect(mocks.updateDraft).not.toHaveBeenCalled();
      expect(mocks.deleteDraft).not.toHaveBeenCalled();
    },
  );
});
