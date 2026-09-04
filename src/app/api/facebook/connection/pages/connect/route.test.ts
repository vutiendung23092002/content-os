import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  requireViewer: vi.fn(),
  rateLimit: vi.fn(),
  parseBody: vi.fn(),
  connectPages: vi.fn(),
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
    connectPages = mocks.connectPages;
  },
}));

import { POST } from "./route";

describe("POST /api/facebook/connection/pages/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireViewer.mockResolvedValue({ id: "viewer-id" });
    mocks.parseBody.mockResolvedValue({
      connectionId: "22222222-2222-4222-8222-222222222222",
      pageIds: ["12345"],
    });
    mocks.connectPages.mockResolvedValue([{ id: "local-page", name: "Page" }]);
  });

  it("checks same-origin and approved viewer before reading the body", async () => {
    mocks.requireViewer.mockRejectedValue(
      new AppError({
        code: "ACCOUNT_NOT_APPROVED",
        message: "Pending",
        status: 403,
      }),
    );

    const response = await POST(
      new Request(
        "https://social.example/api/facebook/connection/pages/connect",
        {
          method: "POST",
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.sameOrigin).toHaveBeenCalledOnce();
    expect(mocks.parseBody).not.toHaveBeenCalled();
    expect(mocks.connectPages).not.toHaveBeenCalled();
  });

  it("passes only the approved viewer, connection ID and Page IDs to the service", async () => {
    const response = await POST(
      new Request(
        "https://social.example/api/facebook/connection/pages/connect",
        {
          method: "POST",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      actor: { id: "viewer-id" },
      action: "facebook:connection:pages",
    });
    expect(mocks.connectPages).toHaveBeenCalledWith({
      viewer: { id: "viewer-id" },
      connectionId: "22222222-2222-4222-8222-222222222222",
      pageIds: ["12345"],
    });
  });
});
