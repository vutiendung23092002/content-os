import { describe, expect, it, vi } from "vitest";
import type { PostRecord } from "@/db/repositories/post-repository";
import type { RemoteFacebookPost } from "./remote-post-reader";
import { RemotePostWeekCache } from "./remote-post-week-cache";

const pageId = "2f6707b7-8594-4d33-b60f-18bdb4f826ac";
const weekStart = new Date("2026-08-16T17:00:00.000Z");

function remotePost(id: string, effectiveAt: string): RemoteFacebookPost {
  return {
    localPostId: null,
    remoteId: id,
    kind: "published",
    message: `Post ${id}`,
    effectiveAt,
    createdAt: effectiveAt,
    updatedAt: effectiveAt,
    permalinkUrl: `https://facebook.test/${id}`,
    imageUrl: null,
    imageUrls: [],
    mediaType: "text",
    engagement: { reactions: 3, comments: 2, shares: 1 },
    source: "facebook",
  };
}

function storedRemotePost(post: RemoteFacebookPost, index = 1): PostRecord {
  return {
    id: `local-${post.remoteId}-${index}`,
    remotePostId: post.remoteId,
    status: post.kind,
    type: post.mediaType,
    message: post.message,
    publishedAt:
      post.kind === "published" && post.effectiveAt
        ? new Date(post.effectiveAt)
        : null,
    scheduledAt:
      post.kind === "scheduled" && post.effectiveAt
        ? new Date(post.effectiveAt)
        : null,
    remoteCreatedAt: post.createdAt ? new Date(post.createdAt) : null,
    remoteUpdatedAt: post.updatedAt ? new Date(post.updatedAt) : null,
    remoteSnapshot: {
      permalinkUrl: post.permalinkUrl,
      imageUrl: post.imageUrl,
      imageUrls: post.imageUrls,
      mediaType: post.mediaType,
      engagement: post.engagement,
      source: post.source,
    },
  } as unknown as PostRecord;
}

describe("RemotePostWeekCache", () => {
  it("serves a completed fresh week from Supabase without calling Meta", async () => {
    const reader = { list: vi.fn() };
    const cachedAt = new Date();
    const cachedRecord = {
      remotePostId: "post-1",
      status: "published",
      message: "Cached post",
      publishedAt: new Date("2026-08-18T02:00:00.000Z"),
      scheduledAt: null,
      remoteCreatedAt: new Date("2026-08-18T02:00:00.000Z"),
      remoteUpdatedAt: null,
      remoteSnapshot: {
        permalinkUrl: "https://facebook.test/post-1",
        imageUrls: [],
        engagement: { reactions: 4, comments: 1, shares: 0 },
      },
    } as unknown as PostRecord;
    const posts = {
      listRemoteWindow: vi.fn().mockResolvedValue([cachedRecord]),
      upsertRemotePosts: vi.fn(),
    };
    const cursors = {
      find: vi.fn().mockResolvedValue({ lastSuccessAt: cachedAt }),
      markSuccess: vi.fn(),
    };
    const cache = new RemotePostWeekCache(reader, posts, cursors);

    const result = await cache.list({
      localPageId: pageId,
      kind: "published",
      weekStart,
    });

    expect(result.cacheStatus).toBe("hit");
    expect(result.stale).toBe(false);
    expect(result.posts[0]).toMatchObject({
      remoteId: "post-1",
      engagement: { reactions: 4, comments: 1, shares: 0 },
    });
    expect(reader.list).not.toHaveBeenCalled();
  });

  it("collapses local and canonical video records with different Facebook ids", async () => {
    const effectiveAt = new Date("2026-08-18T10:07:09.000Z");
    const localVideoRecord = {
      remotePostId: "27878800935145896",
      status: "published",
      type: "video",
      message: "Test video",
      publishedAt: effectiveAt,
      scheduledAt: null,
      remoteCreatedAt: effectiveAt,
      remoteUpdatedAt: null,
      remoteSnapshot: {},
    } as unknown as PostRecord;
    const canonicalRecord = {
      ...localVideoRecord,
      remotePostId: "page-456_122192016956910216",
      publishedAt: new Date("2026-08-18T10:07:20.000Z"),
      remoteSnapshot: {
        permalinkUrl: "https://facebook.test/page-456_122192016956910216",
        imageUrl: "https://facebook.test/thumbnail.jpg",
        imageUrls: ["https://facebook.test/thumbnail.jpg"],
        mediaType: "video",
        engagement: { reactions: 1, comments: 0, shares: 0 },
        source: "facebook",
      },
    } as unknown as PostRecord;
    const posts = {
      listRemoteWindow: vi
        .fn()
        .mockResolvedValue([localVideoRecord, canonicalRecord]),
      upsertRemotePosts: vi.fn(),
    };
    const cache = new RemotePostWeekCache({ list: vi.fn() }, posts, {
      find: vi.fn().mockResolvedValue({ lastSuccessAt: new Date() }),
      markSuccess: vi.fn(),
    });

    const result = await cache.list({
      localPageId: pageId,
      kind: "published",
      weekStart,
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      remoteId: "page-456_122192016956910216",
      imageUrl: "https://facebook.test/thumbnail.jpg",
    });
  });

  it("fetches a cold week with a time window, persists it and records completion", async () => {
    const first = remotePost("post-1", "2026-08-18T02:00:00.000Z");
    const second = remotePost("post-2", "2026-08-19T02:00:00.000Z");
    const reader = {
      list: vi
        .fn()
        .mockResolvedValueOnce({ posts: [first], after: "cursor-1" })
        .mockResolvedValueOnce({ posts: [second], after: null }),
    };
    const posts = {
      listRemoteWindow: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          storedRemotePost(first),
          storedRemotePost(second, 2),
        ]),
      upsertRemotePosts: vi.fn().mockResolvedValue(undefined),
    };
    const cursors = {
      find: vi.fn().mockResolvedValue(undefined),
      markSuccess: vi.fn().mockResolvedValue(undefined),
    };
    const cache = new RemotePostWeekCache(reader, posts, cursors);

    const result = await cache.list({
      localPageId: pageId,
      kind: "published",
      weekStart,
    });

    expect(result.cacheStatus).toBe("refreshed");
    expect(result.posts).toHaveLength(2);
    expect(reader.list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        localPageId: pageId,
        kind: "published",
        limit: 100,
        window: {
          since: weekStart,
          until: new Date("2026-08-23T17:00:00.000Z"),
        },
      }),
    );
    expect(posts.upsertRemotePosts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ remotePostId: "post-1" }),
        expect.objectContaining({ remotePostId: "post-2" }),
      ]),
    );
    expect(cursors.markSuccess).toHaveBeenCalledOnce();
  });

  it("uses the v2 scheduled cursor so legacy single-image snapshots refresh once", async () => {
    const scheduledPost: RemoteFacebookPost = {
      ...remotePost("scheduled-1", "2026-08-18T02:00:00.000Z"),
      kind: "scheduled",
      permalinkUrl: null,
      imageUrl: "https://facebook.test/first.jpg",
      imageUrls: [
        "https://facebook.test/first.jpg",
        "https://facebook.test/second.jpg",
      ],
      engagement: null,
    };
    const reader = {
      list: vi.fn().mockResolvedValue({
        posts: [scheduledPost],
        after: null,
      }),
    };
    const posts = {
      listRemoteWindow: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([storedRemotePost(scheduledPost)]),
      upsertRemotePosts: vi.fn().mockResolvedValue(undefined),
    };
    const cursors = {
      find: vi.fn().mockResolvedValue(undefined),
      markSuccess: vi.fn().mockResolvedValue(undefined),
    };
    const cache = new RemotePostWeekCache(reader, posts, cursors);

    const result = await cache.list({
      localPageId: pageId,
      kind: "scheduled",
      weekStart,
    });

    expect(cursors.find).toHaveBeenCalledWith(
      pageId,
      `remote_posts:scheduled:v2:week:${weekStart.toISOString()}`,
    );
    expect(result.posts[0]?.imageUrls).toEqual([
      "https://facebook.test/first.jpg",
      "https://facebook.test/second.jpg",
    ]);
    expect(posts.upsertRemotePosts).toHaveBeenCalledWith([
      expect.objectContaining({
        remotePostId: "scheduled-1",
        snapshot: expect.objectContaining({
          imageUrls: [
            "https://facebook.test/first.jpg",
            "https://facebook.test/second.jpg",
          ],
        }),
      }),
    ]);
  });

  it("returns stale cached data immediately until refresh is requested", async () => {
    const reader = { list: vi.fn() };
    const posts = {
      listRemoteWindow: vi.fn().mockResolvedValue([]),
      upsertRemotePosts: vi.fn(),
    };
    const cursors = {
      find: vi.fn().mockResolvedValue({
        lastSuccessAt: new Date(Date.now() - 10 * 60 * 1000),
      }),
      markSuccess: vi.fn(),
    };
    const cache = new RemotePostWeekCache(reader, posts, cursors);

    const result = await cache.list({
      localPageId: pageId,
      kind: "published",
      weekStart,
    });

    expect(result).toMatchObject({
      posts: [],
      stale: true,
      cacheStatus: "hit",
    });
    expect(reader.list).not.toHaveBeenCalled();
  });
});
