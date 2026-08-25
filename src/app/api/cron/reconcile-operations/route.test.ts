import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/access/cron-access", () => ({
  assertFacebookCronAccess: mocks.assertAccess,
}));
vi.mock("@/modules/facebook/facebook-reconciliation-cron", () => ({
  FacebookReconciliationCronService: class {
    run = mocks.run;
  },
}));

import { GET, POST } from "./route";

describe("/api/cron/reconcile-operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue({
      status: "completed",
      scanned: 2,
      reconciled: 1,
      needsAttention: 1,
    });
  });

  it.each([GET, POST])(
    "authorizes and runs reconciliation",
    async (handler) => {
      const request = new Request(
        "https://social.example/api/cron/reconcile-operations",
        { headers: { "x-request-id": "reconcile-cron-test" } },
      );

      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(mocks.assertAccess).toHaveBeenCalledWith(request);
      expect(mocks.run).toHaveBeenCalledOnce();
      await expect(response.json()).resolves.toMatchObject({
        result: { status: "completed", reconciled: 1 },
        requestId: "reconcile-cron-test",
      });
    },
  );
});
