import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/access/cron-access", () => ({
  assertFacebookCronAccess: mocks.assertAccess,
}));
vi.mock("@/modules/facebook/facebook-sync-cron", () => ({
  FacebookSyncCronService: class {
    run = mocks.run;
  },
}));

import { GET, POST } from "./route";

describe("/api/cron/sync-facebook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue({
      status: "completed",
      pagesProcessed: 2,
      postsMirrored: 4,
      nextCursor: null,
    });
  });

  it.each([GET, POST])(
    "authorizes and runs the read-only sync",
    async (handler) => {
      const request = new Request(
        "https://social.example/api/cron/sync-facebook",
        { headers: { "x-request-id": "sync-cron-test" } },
      );

      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(mocks.assertAccess).toHaveBeenCalledWith(request);
      expect(mocks.run).toHaveBeenCalledOnce();
      await expect(response.json()).resolves.toMatchObject({
        result: { status: "completed", pagesProcessed: 2 },
        requestId: "sync-cron-test",
      });
    },
  );
});
