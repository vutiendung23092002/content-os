import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import type { PostRecord } from "@/db/repositories/post-repository";
import type { RemoteFacebookPost } from "./remote-post-reader";
import { RemotePostWeekCache } from "./remote-post-week-cache";

const pageId =
  "2f6707b7-8594-4d33-b60f-18bdb4f826ac";

const weekStart =
  new Date("2026-08-16T17:00:00.000Z");

const weekEnd =
  new Date("2026-08-23T17:00:00.000Z");

function remotePost(
  id: string,
  effectiveAt: string,
): RemoteFacebookPost {
  return {
    localPostId: null,
    remoteId: id,
    kind: "published",
    message: `Post ${id}`,
    effectiveAt,
    createdAt: effectiveAt,
    updatedAt: effectiveAt,
    permalinkUrl:
      `https://facebook.test/${id}`,
    imageUrl: null,
    imageUrls: [],
    mediaType: "text",
    engagement: {
      reactions: 3,
      comments: 2,
      shares: 1,
    },
    source: "facebook",
  };
}

function storedRemotePost(
  post: RemoteFacebookPost,
  index = 1,
): PostRecord {
  return {
    id:
      `local-${post.remoteId}-${index}`,
    remotePostId: post.remoteId,
    status: post.kind,
    type: post.mediaType,
    message: post.message,

    publishedAt:
      post.kind === "published" &&
      post.effectiveAt
        ? new Date(post.effectiveAt)
        : null,

    scheduledAt:
      post.kind === "scheduled" &&
      post.effectiveAt
        ? new Date(post.effectiveAt)
        : null,

    remoteCreatedAt:
      post.createdAt
        ? new Date(post.createdAt)
        : null,

    remoteUpdatedAt:
      post.updatedAt
        ? new Date(post.updatedAt)
        : null,

    remoteSnapshot: {
      permalinkUrl:
        post.permalinkUrl,
      imageUrl: post.imageUrl,
      imageUrls: post.imageUrls,
      mediaType: post.mediaType,
      engagement: post.engagement,
      source: post.source,
    },
  } as unknown as PostRecord;
}

function mirrorStore() {
  return {
    replaceWindow: vi
      .fn()
      .mockImplementation(
        async (input: {
          posts: RemoteFacebookPost[];
        }) => ({
          mirrored:
            input.posts.length,
          tombstoned: 0,
        }),
      ),
  };
}

describe("RemotePostWeekCache", () => {
  it(
    "serves a completed fresh week from Supabase without calling Meta",
    async () => {
      const reader = {
        list: vi.fn(),
      };

      const cachedAt =
        new Date();

      const cachedRecord = {
        remotePostId: "post-1",
        status: "published",
        message: "Cached post",
        publishedAt:
          new Date(
            "2026-08-18T02:00:00.000Z",
          ),
        scheduledAt: null,
        remoteCreatedAt:
          new Date(
            "2026-08-18T02:00:00.000Z",
          ),
        remoteUpdatedAt: null,
        remoteSnapshot: {
          permalinkUrl:
            "https://facebook.test/post-1",
          imageUrls: [],
          engagement: {
            reactions: 4,
            comments: 1,
            shares: 0,
          },
        },
      } as unknown as PostRecord;

      const posts = {
        listRemoteWindow: vi
          .fn()
          .mockResolvedValue([
            cachedRecord,
          ]),
      };

      const cursors = {
        find: vi
          .fn()
          .mockResolvedValue({
            lastSuccessAt: cachedAt,
          }),
        markSuccess: vi.fn(),
      };

      const mirror =
        mirrorStore();

      const cache =
        new RemotePostWeekCache(
          reader,
          posts,
          cursors,
          mirror,
        );

      const result =
        await cache.list({
          localPageId: pageId,
          kind: "published",
          weekStart,
        });

      expect(
        result.cacheStatus,
      ).toBe("hit");

      expect(
        result.stale,
      ).toBe(false);

      expect(
        result.posts[0],
      ).toMatchObject({
        remoteId: "post-1",
        engagement: {
          reactions: 4,
          comments: 1,
          shares: 0,
        },
      });

      expect(
        reader.list,
      ).not.toHaveBeenCalled();

      expect(
        mirror.replaceWindow,
      ).not.toHaveBeenCalled();
    },
  );

  it(
    "collapses local and canonical video records with different Facebook ids",
    async () => {
      const effectiveAt =
        new Date(
          "2026-08-18T10:07:09.000Z",
        );

      const localVideoRecord = {
        remotePostId:
          "27878800935145896",
        status: "published",
        type: "video",
        message: "Test video",
        publishedAt: effectiveAt,
        scheduledAt: null,
        remoteCreatedAt:
          effectiveAt,
        remoteUpdatedAt: null,
        remoteSnapshot: {},
      } as unknown as PostRecord;

      const canonicalRecord = {
        ...localVideoRecord,
        remotePostId:
          "page-456_122192016956910216",
        publishedAt:
          new Date(
            "2026-08-18T10:07:20.000Z",
          ),
        remoteSnapshot: {
          permalinkUrl:
            "https://facebook.test/page-456_122192016956910216",
          imageUrl:
            "https://facebook.test/thumbnail.jpg",
          imageUrls: [
            "https://facebook.test/thumbnail.jpg",
          ],
          mediaType: "video",
          engagement: {
            reactions: 1,
            comments: 0,
            shares: 0,
          },
          source: "facebook",
        },
      } as unknown as PostRecord;

      const posts = {
        listRemoteWindow: vi
          .fn()
          .mockResolvedValue([
            localVideoRecord,
            canonicalRecord,
          ]),
      };

      const mirror =
        mirrorStore();

      const cache =
        new RemotePostWeekCache(
          {
            list: vi.fn(),
          },
          posts,
          {
            find: vi
              .fn()
              .mockResolvedValue({
                lastSuccessAt:
                  new Date(),
              }),
            markSuccess: vi.fn(),
          },
          mirror,
        );

      const result =
        await cache.list({
          localPageId: pageId,
          kind: "published",
          weekStart,
        });

      expect(
        result.posts,
      ).toHaveLength(1);

      expect(
        result.posts[0],
      ).toMatchObject({
        remoteId:
          "page-456_122192016956910216",
        imageUrl:
          "https://facebook.test/thumbnail.jpg",
      });

      expect(
        mirror.replaceWindow,
      ).not.toHaveBeenCalled();
    },
  );

  it(
    "fetches a cold week, waits for all pages, replaces the complete window and records completion",
    async () => {
      const first =
        remotePost(
          "post-1",
          "2026-08-18T02:00:00.000Z",
        );

      const second =
        remotePost(
          "post-2",
          "2026-08-19T02:00:00.000Z",
        );

      const reader = {
        list: vi
          .fn()
          .mockResolvedValueOnce({
            posts: [first],
            after: "cursor-1",
          })
          .mockResolvedValueOnce({
            posts: [second],
            after: null,
          }),
      };

      const posts = {
        listRemoteWindow: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            storedRemotePost(first),
            storedRemotePost(
              second,
              2,
            ),
          ]),
      };

      const cursors = {
        find: vi
          .fn()
          .mockResolvedValue(
            undefined,
          ),
        markSuccess: vi
          .fn()
          .mockResolvedValue(
            undefined,
          ),
      };

      const mirror =
        mirrorStore();

      const cache =
        new RemotePostWeekCache(
          reader,
          posts,
          cursors,
          mirror,
        );

      const result =
        await cache.list({
          localPageId: pageId,
          kind: "published",
          weekStart,
        });

      expect(
        result.cacheStatus,
      ).toBe("refreshed");

      expect(
        result.posts,
      ).toHaveLength(2);

      expect(
        reader.list,
      ).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          localPageId: pageId,
          kind: "published",
          limit: 100,
          window: {
            since: weekStart,
            until: weekEnd,
          },
        }),
      );

      expect(
        mirror.replaceWindow,
      ).toHaveBeenCalledTimes(1);

      expect(
        mirror.replaceWindow,
      ).toHaveBeenCalledWith({
        pageId,
        kind: "published",
        windowStart: weekStart,
        windowEnd: weekEnd,
        posts: [
          expect.objectContaining({
            remoteId: "post-1",
          }),
          expect.objectContaining({
            remoteId: "post-2",
          }),
        ],
      });

      expect(
        cursors.markSuccess,
      ).toHaveBeenCalledOnce();
    },
  );

  it(
    "uses the v2 scheduled cursor so legacy single-image snapshots refresh once",
    async () => {
      const scheduledPost:
        RemoteFacebookPost = {
          ...remotePost(
            "scheduled-1",
            "2026-08-18T02:00:00.000Z",
          ),
          kind: "scheduled",
          permalinkUrl: null,
          imageUrl:
            "https://facebook.test/first.jpg",
          imageUrls: [
            "https://facebook.test/first.jpg",
            "https://facebook.test/second.jpg",
          ],
          engagement: null,
        };

      const reader = {
        list: vi
          .fn()
          .mockResolvedValue({
            posts: [
              scheduledPost,
            ],
            after: null,
          }),
      };

      const posts = {
        listRemoteWindow: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            storedRemotePost(
              scheduledPost,
            ),
          ]),
      };

      const cursors = {
        find: vi
          .fn()
          .mockResolvedValue(
            undefined,
          ),
        markSuccess: vi
          .fn()
          .mockResolvedValue(
            undefined,
          ),
      };

      const mirror =
        mirrorStore();

      const cache =
        new RemotePostWeekCache(
          reader,
          posts,
          cursors,
          mirror,
        );

      const result =
        await cache.list({
          localPageId: pageId,
          kind: "scheduled",
          weekStart,
        });

      expect(
        cursors.find,
      ).toHaveBeenCalledWith(
        pageId,
        `remote_posts:scheduled:v2:week:${weekStart.toISOString()}`,
      );

      expect(
        result.posts[0]?.imageUrls,
      ).toEqual([
        "https://facebook.test/first.jpg",
        "https://facebook.test/second.jpg",
      ]);

      expect(
        mirror.replaceWindow,
      ).toHaveBeenCalledWith({
        pageId,
        kind: "scheduled",
        windowStart: weekStart,
        windowEnd: weekEnd,
        posts: [
          expect.objectContaining({
            remoteId:
              "scheduled-1",
            imageUrls: [
              "https://facebook.test/first.jpg",
              "https://facebook.test/second.jpg",
            ],
          }),
        ],
      });

      /*
       * Scheduled API không nhận week window
       * ở reader layer. Ta fetch snapshot rồi
       * filter tuần ở cache layer.
       */
      expect(
        reader.list,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "scheduled",
          window: undefined,
        }),
      );
    },
  );

  it(
    "returns stale cached data immediately until refresh is requested",
    async () => {
      const reader = {
        list: vi.fn(),
      };

      const posts = {
        listRemoteWindow: vi
          .fn()
          .mockResolvedValue([]),
      };

      const cursors = {
        find: vi
          .fn()
          .mockResolvedValue({
            lastSuccessAt:
              new Date(
                Date.now() -
                  10 *
                    60 *
                    1000,
              ),
          }),
        markSuccess: vi.fn(),
      };

      const mirror =
        mirrorStore();

      const cache =
        new RemotePostWeekCache(
          reader,
          posts,
          cursors,
          mirror,
        );

      const result =
        await cache.list({
          localPageId: pageId,
          kind: "published",
          weekStart,
        });

      expect(
        result,
      ).toMatchObject({
        posts: [],
        stale: true,
        cacheStatus: "hit",
      });

      expect(
        reader.list,
      ).not.toHaveBeenCalled();

      expect(
        mirror.replaceWindow,
      ).not.toHaveBeenCalled();
    },
  );

  it(
    "does not reconcile or mark the week complete when Meta pagination fails",
    async () => {
      const first =
        remotePost(
          "post-1",
          "2026-08-18T02:00:00.000Z",
        );

      const reader = {
        list: vi
          .fn()
          .mockResolvedValueOnce({
            posts: [first],
            after: "cursor-1",
          })
          .mockRejectedValueOnce(
            new AppError({
              code:
                "FACEBOOK_NETWORK_ERROR",
              message: "Timeout",
              retryable: true,
            }),
          ),
      };

      const posts = {
        listRemoteWindow: vi
          .fn()
          .mockResolvedValue([]),
      };

      const cursors = {
        find: vi
          .fn()
          .mockResolvedValue(
            undefined,
          ),
        markSuccess: vi.fn(),
      };

      const mirror =
        mirrorStore();

      const cache =
        new RemotePostWeekCache(
          reader,
          posts,
          cursors,
          mirror,
        );

      await expect(
        cache.list({
          localPageId: pageId,
          kind: "published",
          weekStart,
          forceRefresh: true,
        }),
      ).rejects.toMatchObject({
        code:
          "FACEBOOK_NETWORK_ERROR",
      });

      expect(
        mirror.replaceWindow,
      ).not.toHaveBeenCalled();

      expect(
        cursors.markSuccess,
      ).not.toHaveBeenCalled();
    },
  );

  it(
    "rejects a repeated cursor instead of reconciling an incomplete snapshot",
    async () => {
      const first =
        remotePost(
          "post-1",
          "2026-08-18T02:00:00.000Z",
        );

      const second =
        remotePost(
          "post-2",
          "2026-08-19T02:00:00.000Z",
        );

      const reader = {
        list: vi
          .fn()
          .mockResolvedValueOnce({
            posts: [first],
            after: "cursor-1",
          })
          .mockResolvedValueOnce({
            posts: [second],
            after: "cursor-1",
          }),
      };

      const posts = {
        listRemoteWindow: vi
          .fn()
          .mockResolvedValue([]),
      };

      const cursors = {
        find: vi
          .fn()
          .mockResolvedValue(
            undefined,
          ),
        markSuccess: vi.fn(),
      };

      const mirror =
        mirrorStore();

      const cache =
        new RemotePostWeekCache(
          reader,
          posts,
          cursors,
          mirror,
        );

      await expect(
        cache.list({
          localPageId: pageId,
          kind: "published",
          weekStart,
          forceRefresh: true,
        }),
      ).rejects.toMatchObject({
        code:
          "FACEBOOK_SYNC_CURSOR_LOOP",
      });

      expect(
        reader.list,
      ).toHaveBeenCalledTimes(2);

      expect(
        mirror.replaceWindow,
      ).not.toHaveBeenCalled();

      expect(
        cursors.markSuccess,
      ).not.toHaveBeenCalled();
    },
  );
});
