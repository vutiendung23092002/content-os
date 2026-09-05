import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findModel: vi.fn(),
  updateModel: vi.fn(),
}));
vi.mock("@/lib/access/same-origin", () => ({ assertSameOrigin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/security/mutation-rate-limit", () => ({
  assertMutationRateLimit: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/db/repositories/ai-repository", () => ({
  AiRepository: class {
    findModel = mocks.findModel;
    updateModel = mocks.updateModel;
    listModels = vi.fn();
    createModel = vi.fn();
    findProvider = vi.fn();
  },
}));

import { PATCH } from "./route";

const model = {
  id: "00000000-0000-4000-8000-000000000001",
  providerId: "00000000-0000-4000-8000-000000000002",
};
const request = (body: unknown) =>
  new Request("https://app.example/api/admin/ai/models", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PATCH /api/admin/ai/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin" });
    mocks.findModel.mockResolvedValue(model);
    mocks.updateModel.mockImplementation(async (_id, changes) => ({
      ...model,
      ...changes,
    }));
  });
  it("updates admin-managed model fields", async () => {
    const response = await PATCH(
      request({
        id: model.id,
        displayName: "New",
        enabled: true,
        modality: "vision",
        capabilities: { structured: true },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.updateModel).toHaveBeenCalledWith(model.id, {
      displayName: "New",
      enabled: true,
      modality: "vision",
      capabilities: { structured: true },
    });
  });
  it("rejects members, missing models, and sensitive capabilities", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(
      new AppError({ code: "ADMIN_REQUIRED", message: "denied", status: 403 }),
    );
    expect((await PATCH(request({ id: model.id, enabled: true }))).status).toBe(
      403,
    );
    mocks.findModel.mockResolvedValueOnce(undefined);
    await expect(
      (await PATCH(request({ id: model.id, enabled: true }))).json(),
    ).resolves.toMatchObject({ error: { code: "AI_MODEL_NOT_FOUND" } });
    expect(
      (
        await PATCH(
          request({ id: model.id, capabilities: { api_key: "secret" } }),
        )
      ).status,
    ).toBe(400);
  });
});
