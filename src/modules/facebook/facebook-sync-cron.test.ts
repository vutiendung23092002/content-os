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

/**
 * Mirror giả cho unit test.
 *
 * mirrored = số bài snapshot nhận được.
 * tombstoned = 0 vì ở đây không test DB thật.
 */
function mirrorStore() {
  return {
    replaceWindow: vi.fn().mockImplementation(
      async (input: { posts: unknown[] }) => ({
        mirrored: input.posts.length,
        tombstoned: 0,
      }),
    ),
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

    const pages = {
      listActiveBatch: vi.fn(),
    };

    const mirror = mirrorStore();

    const reader = {
      list: vi.fn(),
    };

    const result = await new FacebookSyncCronService(
      jobs,
      pages,
      mirror,
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
    expect(reader.list).not.toHaveBeenCalled();
    expect(mirror.replaceWindow).not.toHaveBeenCalled();
  });

  it("resumes after the last checkpoint and mirrors a native publish after app downtime", async () => {
    const jobs = jobStore("page-1");

    const pages = {
      listActiveBatch: vi
        .fn()
        .mockResolvedValue([page("page-2")]),
    };

    const mirror = mirrorStore();

    const reader = {
      list: vi.fn().mockImplementation(
        async ({ kind }: { kind: string }) =>
          kind === "published"
            ? {
                ...emptyRemotePage(),
                posts: [
                  {
                    localPostId: null,
                    remoteId: "external-page_123",
                    kind: "published",
                    message:
                      "Facebook đã tự đăng khi app offline",
                    effectiveAt:
                      "2026-08-25T03:55:00.000Z",
                    createdAt:
                      "2026-08-25T03:55:00.000Z",
                    updatedAt: null,
                    permalinkUrl:
                      "https://facebook.example/post/123",
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
      mirror,
      reader,
      () => now,
    ).run(5);

    expect(
      pages.listActiveBatch,
    ).toHaveBeenCalledWith({
      afterId: "page-1",
      limit: 5,
    });

    /*
     * syncPage() chạy published trước.
     *
     * Snapshot published đã đọc xong nên cron đưa
     * toàn bộ window vào RemotePostMirror.
     */
    expect(
      mirror.replaceWindow,
    ).toHaveBeenNthCalledWith(1, {
      pageId: "page-2",
      kind: "published",
      windowStart: new Date(
        now.getTime() -
          8 * 24 * 60 * 60 * 1000,
      ),
      windowEnd: new Date(
        now.getTime() + 60_000,
      ),
      posts: [
        expect.objectContaining({
          remoteId: "external-page_123",
          kind: "published",
        }),
      ],
    });

    /*
     * Sau published, syncPage() tiếp tục sync scheduled.
     * Không có bài scheduled nhưng đây vẫn là một
     * snapshot hoàn chỉnh.
     *
     * Vì vậy replaceWindow PHẢI được gọi với posts: [].
     */
    expect(
      mirror.replaceWindow,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pageId: "page-2",
        kind: "scheduled",
        posts: [],
      }),
    );

    expect(
      mirror.replaceWindow,
    ).toHaveBeenCalledTimes(2);

    expect(result).toMatchObject({
      status: "completed",
      pagesProcessed: 1,
      postsMirrored: 1,
      nextCursor: null,
    });
  });

  it("waits until all remote pages are fetched before replacing the published window", async () => {
    const jobs = jobStore();

    const pages = {
      listActiveBatch: vi
        .fn()
        .mockResolvedValue([page("page-1")]),
    };

    const mirror = mirrorStore();

    const firstPost = {
      localPostId: null,
      remoteId: "external-page_101",
      kind: "published" as const,
      message: "Bài trang đầu",
      effectiveAt:
        "2026-08-25T03:50:00.000Z",
      createdAt:
        "2026-08-25T03:50:00.000Z",
      updatedAt: null,
      permalinkUrl:
        "https://facebook.example/post/101",
      imageUrl: null,
      imageUrls: [],
      mediaType: "text" as const,
      engagement: null,
      source: "facebook" as const,
    };

    const secondPost = {
      ...firstPost,
      remoteId: "external-page_102",
      message: "Bài trang hai",
      effectiveAt:
        "2026-08-25T03:55:00.000Z",
      createdAt:
        "2026-08-25T03:55:00.000Z",
    };

    const reader = {
      list: vi
        .fn()

        // published page 1
        .mockResolvedValueOnce({
          ...emptyRemotePage(),
          posts: [firstPost],
          after: "cursor-published-1",
        })

        // published page 2
        .mockResolvedValueOnce({
          ...emptyRemotePage(),
          posts: [secondPost],
          after: null,
        })

        // scheduled
        .mockResolvedValueOnce(
          emptyRemotePage(),
        ),
    };

    await new FacebookSyncCronService(
      jobs,
      pages,
      mirror,
      reader,
      () => now,
    ).run(5);

    /*
     * Call đầu tiên tới mirror phải chứa CẢ HAI
     * bài từ hai trang Facebook.
     *
     * Nếu code gọi replaceWindow sau page 1,
     * test này sẽ fail.
     */
    expect(
      mirror.replaceWindow,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pageId: "page-1",
        kind: "published",
        posts: [
          expect.objectContaining({
            remoteId:
              "external-page_101",
          }),
          expect.objectContaining({
            remoteId:
              "external-page_102",
          }),
        ],
      }),
    );

    expect(
      mirror.replaceWindow,
    ).toHaveBeenCalledTimes(2);
  });

  it("does not reconcile an incomplete snapshot when pagination fails", async () => {
    const jobs = jobStore();

    const pages = {
      listActiveBatch: vi
        .fn()
        .mockResolvedValue([page("page-1")]),
    };

    const mirror = mirrorStore();

    const firstPost = {
      localPostId: null,
      remoteId: "external-page_101",
      kind: "published" as const,
      message: "Trang đầu",
      effectiveAt:
        "2026-08-25T03:50:00.000Z",
      createdAt:
        "2026-08-25T03:50:00.000Z",
      updatedAt: null,
      permalinkUrl: null,
      imageUrl: null,
      imageUrls: [],
      mediaType: "text" as const,
      engagement: null,
      source: "facebook" as const,
    };

    const reader = {
      list: vi
        .fn()

        // Page đầu đọc được.
        .mockResolvedValueOnce({
          ...emptyRemotePage(),
          posts: [firstPost],
          after: "cursor-1",
        })

        // Page tiếp theo lỗi.
        // readWithRetry() retry thêm một lần.
        .mockRejectedValueOnce(
          new AppError({
            code: "GRAPH_TEMPORARY",
            message: "temporary",
            retryable: true,
          }),
        )
        .mockRejectedValueOnce(
          new AppError({
            code: "GRAPH_TEMPORARY",
            message: "temporary",
            retryable: true,
          }),
        ),
    };

    const service =
      new FacebookSyncCronService(
        jobs,
        pages,
        mirror,
        reader,
        () => now,
        async () => undefined,
      );

    await expect(
      service.run(5),
    ).rejects.toMatchObject({
      code: "GRAPH_TEMPORARY",
    });

    /*
     * Snapshot published chưa hoàn chỉnh.
     *
     * Tuyệt đối không được gọi mirror,
     * nếu không các post nằm ở page 2 trở đi
     * có thể bị tombstone nhầm.
     */
    expect(
      mirror.replaceWindow,
    ).not.toHaveBeenCalled();

    expect(
      jobs.checkpoint,
    ).not.toHaveBeenCalled();

    expect(jobs.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: "GRAPH_TEMPORARY",
          retryable: true,
        },
      }),
    );
  });

  it("checkpoints completed Pages and stops after a bounded retry on partial failure", async () => {
    const jobs = jobStore();

    const pages = {
      listActiveBatch: vi
        .fn()
        .mockResolvedValue([
          page("page-1"),
          page("page-2"),
        ]),
    };

    const mirror = mirrorStore();

    const reader = {
      list: vi.fn().mockImplementation(
        async ({
          localPageId,
        }: {
          localPageId: string;
        }) => {
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

    const service =
      new FacebookSyncCronService(
        jobs,
        pages,
        mirror,
        reader,
        () => now,
        async () => undefined,
      );

    await expect(
      service.run(5),
    ).rejects.toMatchObject({
      code: "GRAPH_TEMPORARY",
    });

    /*
     * page-1:
     *
     * published -> complete
     * scheduled -> complete
     *
     * nên Page 1 được checkpoint.
     */
    expect(
      jobs.checkpoint,
    ).toHaveBeenCalledTimes(1);

    expect(
      jobs.checkpoint,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "page-1",
      }),
    );

    /*
     * page-1:
     *   published = 1 request
     *   scheduled = 1 request
     *
     * page-2 published:
     *   attempt 1 fail
     *   attempt 2 fail
     *
     * tổng = 4.
     */
    expect(
      reader.list,
    ).toHaveBeenCalledTimes(4);

    /*
     * Chỉ page-1 có snapshot hoàn chỉnh:
     *
     * published + scheduled = 2 mirror calls.
     *
     * page-2 chưa complete nên không được mirror.
     */
    expect(
      mirror.replaceWindow,
    ).toHaveBeenCalledTimes(2);

    expect(jobs.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: "GRAPH_TEMPORARY",
          retryable: true,
        },
      }),
    );
  });
});