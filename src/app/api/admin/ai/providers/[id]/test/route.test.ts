import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  findProvider: vi.fn(),
  listModels: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("@/lib/access/same-origin", () => ({ assertSameOrigin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: mocks.requireSuperAdmin,
}));
vi.mock("@/lib/security/mutation-rate-limit", () => ({
  assertMutationRateLimit: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/db/repositories/ai-repository", () => ({
  AiRepository: class {
    findProvider = mocks.findProvider;
  },
}));
vi.mock("@/lib/crypto/token-keyring", () => ({
  getTokenKeyring: () => ({ decrypt: mocks.decrypt }),
}));
vi.mock("@/modules/ai/providers/openai-compatible", () => ({
  OpenAiCompatibleProvider: class {
    listModels = mocks.listModels;
  },
}));

import { POST } from "./route";

const provider = {
  id: "00000000-0000-4000-8000-000000000001",
  enabled: true,
  baseUrl: "https://api.example.test",
  apiKeyCiphertext: "ciphertext",
  apiKeyNonce: "nonce",
  apiKeyAuthTag: "auth-tag",
  apiKeyVersion: 1,
  apiKeyFingerprint: "fingerprint",
};

describe("provider connection test route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSuperAdmin.mockResolvedValue({ id: "admin" });
    mocks.findProvider.mockResolvedValue(provider);
    mocks.decrypt.mockReturnValue("plaintext-key");
    mocks.listModels.mockResolvedValue([{ id: "model", metadata: {} }]);
  });

  it("allows Super Admin and returns only a sanitized summary", async () => {
    const response = await POST(
      new Request("https://app.example/api/admin/ai/providers/x/test", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: provider.id }) },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      providerId: provider.id,
      modelCount: 1,
    });
    expect(JSON.stringify(body)).not.toContain("plaintext-key");
    expect(body).not.toHaveProperty("ciphertext");
    expect(body).not.toHaveProperty("fingerprint");
  });

  it("returns stable sanitized errors for missing providers and credentials", async () => {
    mocks.findProvider.mockResolvedValueOnce(undefined);
    let response = await POST(
      new Request("https://app.example/api/admin/ai/providers/x/test", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: provider.id }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("AI_PROVIDER_NOT_FOUND");
    mocks.findProvider.mockResolvedValueOnce({
      ...provider,
      apiKeyCiphertext: null,
    });
    response = await POST(
      new Request("https://app.example/api/admin/ai/providers/x/test", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: provider.id }) },
    );
    expect((await response.json()).error.code).toBe("AI_PROVIDER_KEY_MISSING");
  });

  it("propagates RBAC and upstream failures as sanitized errors", async () => {
    mocks.requireSuperAdmin.mockRejectedValueOnce(
      new AppError({
        code: "SUPER_ADMIN_REQUIRED",
        message: "denied",
        status: 403,
      }),
    );
    let response = await POST(
      new Request("https://app.example/api/admin/ai/providers/x/test", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: provider.id }) },
    );
    expect(response.status).toBe(403);
    mocks.listModels.mockRejectedValueOnce(
      new AppError({
        code: "AI_PROVIDER_RATE_LIMITED",
        message: "upstream",
        status: 503,
      }),
    );
    response = await POST(
      new Request("https://app.example/api/admin/ai/providers/x/test", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: provider.id }) },
    );
    expect((await response.json()).error.code).toBe("AI_PROVIDER_RATE_LIMITED");
  });
});
