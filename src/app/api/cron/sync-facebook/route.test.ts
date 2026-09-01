import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  initializeService: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/access/cron-access", () => ({
  assertFacebookCronAccess: mocks.assertAccess,
}));
vi.mock("@/modules/facebook/facebook-sync-cron", () => {
  return {
    FacebookSyncCronService: class {
      constructor() {
        mocks.initializeService();
      }

      run = mocks.run;
    },
  };
});

describe("/api/cron/sync-facebook", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.assertAccess.mockImplementation(() => undefined);
    mocks.run.mockResolvedValue({
      status: "completed",
      pagesProcessed: 2,
      postsMirrored: 4,
      nextCursor: null,
    });
  });

  it.each(["GET", "POST"] as const)(
    "authorizes and runs the read-only sync for %s",
    async (method) => {
      const route = await import("./route");
      const handler = route[method];
      const request = new Request(
        "https://social.example/api/cron/sync-facebook",
        { headers: { "x-request-id": "sync-cron-test" } },
      );

      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(mocks.assertAccess).toHaveBeenCalledWith(request);
      expect(mocks.initializeService).toHaveBeenCalledOnce();
      expect(mocks.run).toHaveBeenCalledOnce();
      await expect(response.json()).resolves.toMatchObject({
        result: { status: "completed", pagesProcessed: 2 },
        requestId: "sync-cron-test",
      });
    },
  );

  it.each(["GET", "POST"] as const)(
    "returns 401 for unauthenticated %s without initializing the sync service",
    async (method) => {
      const route = await import("./route");
      const { AppError } = await import("@/lib/errors/app-error");
      const handler = route[method];
      mocks.assertAccess.mockImplementation(() => {
        throw new AppError({
          code: "FACEBOOK_CRON_UNAUTHORIZED",
          message: "Cron Facebook khong duoc phep.",
          status: 401,
        });
      });
      const request = new Request(
        "https://social.example/api/cron/sync-facebook",
        { headers: { "x-request-id": "unauthorized-sync-cron-test" } },
      );

      const response = await handler(request);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "FACEBOOK_CRON_UNAUTHORIZED",
          requestId: "unauthorized-sync-cron-test",
        },
      });
      expect(mocks.initializeService).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );
});
