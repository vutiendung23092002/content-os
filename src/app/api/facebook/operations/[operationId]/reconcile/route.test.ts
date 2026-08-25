import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  requireAdmin: vi.fn(),
  reconcile: vi.fn(),
  resolveManually: vi.fn(),
}));

vi.mock("@/lib/access/same-origin", () => ({
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/modules/facebook/reconcile-operations", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/modules/facebook/reconcile-operations")
    >();
  return {
    ...original,
    ReconcileFacebookOperationService: class {
      reconcile = mocks.reconcile;
      resolveManually = mocks.resolveManually;
    },
  };
});

import { PATCH, POST } from "./route";

const operationId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";
const actorId = "018f0d44-35f0-7b63-99d2-c1b9222cd060";
const context = { params: Promise.resolve({ operationId }) };

function request(method: "POST" | "PATCH", body?: unknown) {
  return new Request(
    `https://social.example/api/facebook/operations/${operationId}/reconcile`,
    {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        origin: "https://social.example",
        host: "social.example",
        "content-type": "application/json",
        "x-request-id": "reconcile-route-test",
      },
    },
  );
}

describe("Facebook operation reconciliation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: actorId, role: "admin" });
    mocks.reconcile.mockResolvedValue({
      operationId,
      status: "needs_attention",
      resolution: "unresolved",
      reason: "no_match",
    });
    mocks.resolveManually.mockResolvedValue({
      operationId,
      status: "failed",
      resolution: "remote_not_created",
      reason: "manual_remote_not_created",
    });
  });

  it("guards automatic reconciliation with same-origin and Admin access", async () => {
    const response = await POST(request("POST"), context);

    expect(response.status).toBe(200);
    expect(mocks.assertSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.reconcile).toHaveBeenCalledWith(operationId);
  });

  it("passes the authenticated Admin identity into manual resolution", async () => {
    const resolution = {
      resolution: "remote_not_created",
      note: "Đã đối chiếu Business Suite và xác nhận không có bài.",
    };
    const response = await PATCH(request("PATCH", resolution), context);

    expect(response.status).toBe(200);
    expect(mocks.assertSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.resolveManually).toHaveBeenCalledWith({
      operationId,
      actorUserId: actorId,
      resolution,
    });
  });
});
