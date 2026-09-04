import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  requireViewer: vi.fn(),
  rateLimit: vi.fn(),
  parseBody: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/lib/access/same-origin", () => ({
  assertSameOrigin: mocks.sameOrigin,
}));
vi.mock("@/lib/auth/session", () => ({
  requireApprovedViewer: mocks.requireViewer,
}));
vi.mock("@/lib/security/mutation-rate-limit", () => ({
  assertMutationRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/http/request-body", () => ({
  parseJsonBody: mocks.parseBody,
}));
vi.mock("@/modules/facebook/user-facebook-connection-service", () => ({
  UserFacebookConnectionService: class {
    disconnect = mocks.disconnect;
  },
}));

import { POST } from "./route";

describe("POST /api/facebook/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireViewer.mockResolvedValue({ id: "viewer-a" });
    mocks.parseBody.mockResolvedValue({
      connectionId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("returns the safe ownership failure from the service", async () => {
    mocks.disconnect.mockRejectedValue(
      new AppError({
        code: "FACEBOOK_CONNECTION_NOT_FOUND",
        message: "Not found",
        status: 404,
      }),
    );

    const response = await POST(
      new Request("https://social.example/api/facebook/disconnect", {
        method: "POST",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("FACEBOOK_CONNECTION_NOT_FOUND");
    expect(mocks.disconnect).toHaveBeenCalledWith(
      { id: "viewer-a" },
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("does not parse input when same-origin validation rejects the request", async () => {
    mocks.sameOrigin.mockImplementation(() => {
      throw new AppError({
        code: "CROSS_ORIGIN_REQUEST",
        message: "Rejected",
        status: 403,
      });
    });

    const response = await POST(
      new Request("https://attacker.example/api/facebook/disconnect", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireViewer).not.toHaveBeenCalled();
    expect(mocks.parseBody).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });
});
