import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireViewer: vi.fn(),
  complete: vi.fn(),
  rejectCallback: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireApprovedViewer: mocks.requireViewer,
}));
vi.mock("@/modules/facebook/facebook-connect-config", () => ({
  getFacebookConnectSiteUrl: () => new URL("https://social.example"),
}));
vi.mock("@/modules/facebook/user-facebook-connection-service", () => ({
  UserFacebookConnectionService: class {
    complete = mocks.complete;
    rejectCallback = mocks.rejectCallback;
  },
}));

import { GET } from "./route";

describe("GET /api/facebook/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireViewer.mockResolvedValue({ id: "viewer-id" });
  });

  it("completes with the current viewer and removes code/state from the redirect", async () => {
    const response = await GET(
      new Request(
        "https://social.example/api/facebook/callback?code=secret-code&state=state-value",
      ),
    );
    expect(mocks.complete).toHaveBeenCalledWith({
      viewer: { id: "viewer-id" },
      code: "secret-code",
      state: "state-value",
    });
    expect(response.headers.get("location")).toBe(
      "https://social.example/pages?facebook=connected",
    );
    expect(response.headers.get("location")).not.toContain("secret-code");
  });

  it("consumes denied callbacks without exposing provider details", async () => {
    const response = await GET(
      new Request(
        "https://social.example/api/facebook/callback?error=access_denied&error_description=sensitive&state=state-value",
      ),
    );
    expect(mocks.rejectCallback).toHaveBeenCalledWith(
      { id: "viewer-id" },
      "state-value",
    );
    expect(response.headers.get("location")).toBe(
      "https://social.example/pages?facebook=denied",
    );
  });
});
