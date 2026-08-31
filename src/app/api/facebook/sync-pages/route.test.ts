import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({
  assertInternalAdminAccess: vi.fn(),
  assertSameOrigin: vi.fn(),
  hasConfiguredSecretAccess: vi.fn(),
  syncManagedPages: vi.fn(),
}));

vi.mock("@/lib/access/internal-access", () => ({
  assertInternalAdminAccess: mocks.assertInternalAdminAccess,
  hasConfiguredSecretAccess: mocks.hasConfiguredSecretAccess,
}));
vi.mock("@/lib/access/same-origin", () => ({
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/lib/env/server", () => ({
  requireServerEnv: vi.fn((key: string) => key),
}));
vi.mock("@/lib/crypto/token-keyring", () => ({
  getTokenKeyring: vi.fn(() => ({ encrypt: vi.fn() })),
}));
vi.mock("@/modules/facebook/meta-client", () => ({
  MetaGraphClient: class {},
}));
vi.mock("@/modules/facebook/sync-managed-pages", () => ({
  syncManagedPages: mocks.syncManagedPages,
}));

import { POST } from "./route";

function request(): Request {
  return new Request("https://social.example/api/facebook/sync-pages", {
    method: "POST",
  });
}

describe("POST /api/facebook/sync-pages security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasConfiguredSecretAccess.mockReturnValue(false);
    mocks.assertInternalAdminAccess.mockResolvedValue(undefined);
    mocks.syncManagedPages.mockResolvedValue([]);
  });

  it("requires same-origin before checking a browser admin session", async () => {
    mocks.assertSameOrigin.mockImplementation(() => {
      throw new AppError({
        code: "ORIGIN_REQUIRED",
        message: "Nguồn yêu cầu không hợp lệ.",
        status: 403,
      });
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.assertSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.assertInternalAdminAccess).not.toHaveBeenCalled();
    expect(mocks.syncManagedPages).not.toHaveBeenCalled();
  });

  it("allows configured machine-secret access without an Origin header", async () => {
    mocks.hasConfiguredSecretAccess.mockReturnValue(true);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.assertSameOrigin).not.toHaveBeenCalled();
    expect(mocks.assertInternalAdminAccess).toHaveBeenCalledOnce();
    expect(mocks.syncManagedPages).toHaveBeenCalledOnce();
  });
});
