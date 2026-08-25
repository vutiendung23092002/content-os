import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import { FacebookSyncCronService } from "./facebook-sync-cron";

const now = new Date("2026-08-25T04:00:00.000Z");

function page(id: string) {
  return {
    id,
    externalPageId: `external-${id}`,
    name: `Page ${id}`,
    category: null,
    avatarUrl: null,
    timezone: "Asia/Ho_Chi_Minh",
    connectionStatus: "active",
    isActive: true,
    lastPermissionCheckAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function claimed(cursor: string | null = null) {
  return {
    jobKey: "facebook.remote-post-sync",
    cursor,
    leaseOwner: "owner",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    lastStartedAt: now,
    lastSuccessAt: null,
    lastError: null,
    updatedAt: now,
  };
}

function jobStore(cursor: string | null = null) {
  return {
    claim: vi.fn().mockResolvedValue(claimed(cursor)),
    checkpoint: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
  };
}

function emptyRemotePage() {
  return {
    page: {
      id: "local-page",
      externalPageId: "external-page",
      name: "Page",
      avatarUrl: null,
      timezone: "Asia/Ho_Chi_Minh",
    },
    posts: [],
    after: null,
    fetchedAt: now.toISOString(),
  };
}

describe("FacebookSyncCronService", () => {
  it("skips the run when another worker owns the lease", async () => {
    const jobs = jobStore();
    jobs.claim.mockResolvedValue(undefined);
    const pages = { listActiveBatch: vi.fn() };
    const reader = { list: vi.fn() };
    const posts = { upsertRemotePosts: vi.fn() };

    const result = await new FacebookSyncCronService(
      jobs,
      pages,
      posts,
      reader,
      () => now,
    ).run();

    expect(result).toEqual({
      status: "locked",
      pagesProcessed: 0,
      postsMirrored: 0,
      nextCursor: null,
    });
    expect(pages.listActiveBatch).not.toHaveBeenCalled();
  });

  it("resumes after the last checkpoint and mirrors a native publish after app downtime", async () => {
    const jobs = jobStore("page-1");
    const pages = {
      listActiveBatch: vi.fn().mockResolvedValue([page("page-2")]),
    };
    const posts = { upsertRemotePosts: vi.fn().mockResolvedValue(undefined) };
    const reader = {
      list: vi.fn().mockImplementation(async ({ kind }: { kind: string }) =>
        kind === "published"
          ? {
              ...emptyRemotePage(),
              posts: [
                {
                  remoteId: "external-page_123",
                  kind: "published",
                  message: "Facebook đã tự đăng khi app offline",
                  effectiveAt: "2026-08-25T03:55:00.000Z",
                  createdAt: "2026-08-25T03:55:00.000Z",
                  updatedAt: null,
                  permalinkUrl: "https://facebook.example/post/123",
                  imageUrl: null,
                  imageUrls: [],
                  mediaType: "text",
                  engagement: null,
                  source: "facebook",
                },
              ],
            }
          : emptyRemotePage(),
      ),
    };

    const result = await new FacebookSyncCronService(
      jobs,
      pages,
      posts,
      reader,
      () => now,
    ).run(5);

    expect(pages.listActiveBatch).toHaveBeenCalledWith({
      afterId: "page-1",
      limit: 5,
    });
    expect(posts.upsertRemotePosts).toHaveBeenCalledWith([
      expect.objectContaining({
        pageId: "page-2",
        remotePostId: "external-page_123",
        kind: "published",
      }),
    ]);
    expect(result).toMatchObject({
      status: "completed",
      pagesProcessed: 1,
      postsMirrored: 1,
      nextCursor: null,
    });
  });

  it("checkpoints completed Pages and stops after a bounded retry on partial failure", async () => {
    const jobs = jobStore();
    const pages = {
      listActiveBatch: vi
        .fn()
        .mockResolvedValue([page("page-1"), page("page-2")]),
    };
    const posts = { upsertRemotePosts: vi.fn().mockResolvedValue(undefined) };
    const reader = {
      list: vi
        .fn()
        .mockImplementation(
          async ({ localPageId }: { localPageId: string }) => {
            if (localPageId === "page-2") {
              throw new AppError({
                code: "GRAPH_TEMPORARY",
                message: "temporary",
                retryable: true,
              });
            }
            return emptyRemotePage();
          },
        ),
    };

    const service = new FacebookSyncCronService(
      jobs,
      pages,
      posts,
      reader,
      () => now,
      async () => undefined,
    );

    await expect(service.run(5)).rejects.toMatchObject({
      code: "GRAPH_TEMPORARY",
    });
    expect(jobs.checkpoint).toHaveBeenCalledTimes(1);
    expect(jobs.checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "page-1" }),
    );
    expect(reader.list).toHaveBeenCalledTimes(4);
    expect(jobs.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: "GRAPH_TEMPORARY", retryable: true },
      }),
    );
  });
});
