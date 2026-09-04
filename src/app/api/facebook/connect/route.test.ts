import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({ requireViewer: vi.fn(), begin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireApprovedViewer: mocks.requireViewer,
}));
vi.mock("@/modules/facebook/user-facebook-connection-service", () => ({
  UserFacebookConnectionService: class {
    begin = mocks.begin;
  },
}));

import { GET } from "./route";

describe("GET /api/facebook/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireViewer.mockResolvedValue({ id: "viewer-id" });
    mocks.begin.mockResolvedValue(
      "https://www.facebook.com/v26.0/dialog/oauth?state=safe-state",
    );
  });

  it("rejects an unauthenticated viewer before creating OAuth state", async () => {
    mocks.requireViewer.mockRejectedValue(
      new AppError({
        code: "AUTHENTICATION_REQUIRED",
        message: "Login",
        status: 401,
      }),
    );
    const response = await GET(
      new Request("https://social.example/api/facebook/connect"),
    );
    expect(response.status).toBe(401);
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("rejects an unapproved viewer before creating OAuth state", async () => {
    mocks.requireViewer.mockRejectedValue(
      new AppError({
        code: "ACCOUNT_NOT_APPROVED",
        message: "Pending",
        status: 403,
      }),
    );

    const response = await GET(
      new Request("https://social.example/api/facebook/connect"),
    );

    expect(response.status).toBe(403);
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("redirects an approved viewer to App B", async () => {
    const response = await GET(
      new Request("https://social.example/api/facebook/connect"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "www.facebook.com/v26.0/dialog/oauth",
    );
    expect(mocks.begin).toHaveBeenCalledWith({ id: "viewer-id" });
  });
});
