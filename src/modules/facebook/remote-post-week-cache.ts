import "server-only";
import { getDatabase } from "@/db/client";
import {
  PostRepository,
  type PostRecord,
  type RemotePostCacheInput,
} from "@/db/repositories/post-repository";
import { SyncCursorRepository } from "@/db/repositories/sync-cursor-repository";
import {
  RemotePostReader,
  type RemoteFacebookPost,
  type RemotePostKind,
} from "./remote-post-reader";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SYNC_PAGES = 100;
const inFlightSyncs = new Map<string, Promise<RemoteFacebookPost[]>>();

type PostRepositoryPort = Pick<
  PostRepository,
  "listRemoteWindow" | "upsertRemotePosts"
>;
type SyncCursorRepositoryPort = Pick<
  SyncCursorRepository,
  "find" | "markSuccess"
>;
type RemotePostReaderPort = Pick<RemotePostReader, "list">;

type RemoteSnapshot = {
  permalinkUrl?: unknown;
  imageUrl?: unknown;
  imageUrls?: unknown;
  engagement?: unknown;
};

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asImageUrls(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asEngagement(value: unknown): RemoteFacebookPost["engagement"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.reactions !== "number" ||
    typeof record.comments !== "number" ||
    typeof record.shares !== "number"
  )
    return null;
  return {
    reactions: record.reactions,
    comments: record.comments,
    shares: record.shares,
  };
}

function toRemotePost(record: PostRecord): RemoteFacebookPost | null {
  if (
    !record.remotePostId ||
    (record.status !== "published" && record.status !== "scheduled")
  )
    return null;
  const snapshot = record.remoteSnapshot as RemoteSnapshot;
  const effectiveAt =
    record.status === "scheduled" ? record.scheduledAt : record.publishedAt;
  const imageUrls = asImageUrls(snapshot.imageUrls);
  const imageUrl = asNullableString(snapshot.imageUrl) ?? imageUrls[0] ?? null;

  return {
    remoteId: record.remotePostId,
    kind: record.status,
    message: record.message,
    effectiveAt: effectiveAt?.toISOString() ?? null,
    createdAt: record.remoteCreatedAt?.toISOString() ?? null,
    updatedAt: record.remoteUpdatedAt?.toISOString() ?? null,
    permalinkUrl: asNullableString(snapshot.permalinkUrl),
    imageUrl,
    imageUrls,
    engagement: asEngagement(snapshot.engagement),
    source: "facebook",
  };
}

function toCacheInput(
  pageId: string,
  post: RemoteFacebookPost,
): RemotePostCacheInput {
  return {
    pageId,
    remotePostId: post.remoteId,
    kind: post.kind,
    message: post.message,
    effectiveAt: post.effectiveAt ? new Date(post.effectiveAt) : null,
    createdAt: post.createdAt ? new Date(post.createdAt) : null,
    updatedAt: post.updatedAt ? new Date(post.updatedAt) : null,
    snapshot: {
      permalinkUrl: post.permalinkUrl,
      imageUrl: post.imageUrl,
      imageUrls: post.imageUrls,
      engagement: post.engagement,
      source: post.source,
    },
  };
}

function syncType(kind: RemotePostKind, weekStart: Date): string {
  return `remote_posts:${kind}:week:${weekStart.toISOString()}`;
}

function mergeRemotePosts(posts: RemoteFacebookPost[]): RemoteFacebookPost[] {
  return [...new Map(posts.map((post) => [post.remoteId, post])).values()];
}

export class RemotePostWeekCache {
  constructor(
    private readonly reader: RemotePostReaderPort = new RemotePostReader(),
    private readonly postRepository: PostRepositoryPort = new PostRepository(
      getDatabase(),
    ),
    private readonly syncRepository: SyncCursorRepositoryPort = new SyncCursorRepository(
      getDatabase(),
    ),
  ) {}

  async list(input: {
    localPageId: string;
    kind: RemotePostKind;
    weekStart: Date;
    forceRefresh?: boolean;
  }): Promise<{
    posts: RemoteFacebookPost[];
    fetchedAt: string;
    stale: boolean;
    cacheStatus: "hit" | "refreshed";
  }> {
    const weekEnd = new Date(input.weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const type = syncType(input.kind, input.weekStart);
    const [state, cachedRecords] = await Promise.all([
      this.syncRepository.find(input.localPageId, type),
      this.postRepository.listRemoteWindow(
        input.localPageId,
        input.kind,
        input.weekStart,
        weekEnd,
      ),
    ]);
    const cachedPosts = cachedRecords
      .map(toRemotePost)
      .filter((post): post is RemoteFacebookPost => post !== null);
    const hasSnapshot = Boolean(state?.lastSuccessAt);
    const stale =
      !state?.lastSuccessAt ||
      Date.now() - state.lastSuccessAt.getTime() > CACHE_TTL_MS;

    if (hasSnapshot && !input.forceRefresh) {
      return {
        posts: cachedPosts,
        fetchedAt: state!.lastSuccessAt!.toISOString(),
        stale,
        cacheStatus: "hit",
      };
    }

    const key = `${input.localPageId}:${type}`;
    let sync = inFlightSyncs.get(key);
    if (!sync) {
      sync = this.syncWeek({ ...input, weekEnd, syncType: type }).finally(() =>
        inFlightSyncs.delete(key),
      );
      inFlightSyncs.set(key, sync);
    }
    const posts = await sync;

    return {
      posts,
      fetchedAt: new Date().toISOString(),
      stale: false,
      cacheStatus: "refreshed",
    };
  }

  private async syncWeek(input: {
    localPageId: string;
    kind: RemotePostKind;
    weekStart: Date;
    weekEnd: Date;
    syncType: string;
  }): Promise<RemoteFacebookPost[]> {
    let after: string | undefined;
    const collected: RemoteFacebookPost[] = [];
    const seenCursors = new Set<string>();

    for (let pageNumber = 0; pageNumber < MAX_SYNC_PAGES; pageNumber += 1) {
      const result = await this.reader.list({
        localPageId: input.localPageId,
        kind: input.kind,
        after,
        limit: 100,
        window:
          input.kind === "published"
            ? { since: input.weekStart, until: input.weekEnd }
            : undefined,
      });
      collected.push(...result.posts);

      if (!result.after || result.posts.length === 0) break;
      if (seenCursors.has(result.after)) break;
      seenCursors.add(result.after);
      after = result.after;
    }

    const posts = mergeRemotePosts(collected).filter((post) => {
      if (!post.effectiveAt) return false;
      const effectiveAt = new Date(post.effectiveAt).getTime();
      return (
        effectiveAt >= input.weekStart.getTime() &&
        effectiveAt < input.weekEnd.getTime()
      );
    });
    await this.postRepository.upsertRemotePosts(
      posts.map((post) => toCacheInput(input.localPageId, post)),
    );
    await this.syncRepository.markSuccess({
      pageId: input.localPageId,
      syncType: input.syncType,
      windowStart: input.weekStart,
      windowEnd: input.weekEnd,
    });
    return posts;
  }
}
