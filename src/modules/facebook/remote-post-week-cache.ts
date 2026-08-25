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
// v2 adds all scheduled-photo attachments to the cached snapshot. Keeping the
// version in the cursor key invalidates legacy week snapshots exactly once.
const SCHEDULED_CACHE_FORMAT_VERSION = 2;
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
  mediaType?: unknown;
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
    mediaType:
      snapshot.mediaType === "video" ||
      snapshot.mediaType === "image" ||
      snapshot.mediaType === "text"
        ? snapshot.mediaType
        : record.type,
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
      mediaType: post.mediaType,
      engagement: post.engagement,
      source: post.source,
    },
  };
}

function syncType(kind: RemotePostKind, weekStart: Date): string {
  const version =
    kind === "scheduled" ? `:v${SCHEDULED_CACHE_FORMAT_VERSION}` : "";
  return `remote_posts:${kind}${version}:week:${weekStart.toISOString()}`;
}

function remotePostIdentity(remoteId: string): string {
  const separator = remoteId.lastIndexOf("_");
  return separator >= 0 ? remoteId.slice(separator + 1) : remoteId;
}

function remotePostCompleteness(post: RemoteFacebookPost): number {
  return (
    (post.remoteId.includes("_") ? 2 : 0) +
    (post.permalinkUrl ? 4 : 0) +
    (post.imageUrl ? 2 : 0) +
    Math.min(post.imageUrls.length, 3) +
    (post.engagement ? 1 : 0)
  );
}

function normalizedPostMessage(post: RemoteFacebookPost): string {
  return post.message.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function postEffectiveTime(post: RemoteFacebookPost): number | null {
  if (!post.effectiveAt) return null;
  const timestamp = new Date(post.effectiveAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isIncompleteSubmission(post: RemoteFacebookPost): boolean {
  return (
    !post.permalinkUrl &&
    !post.imageUrl &&
    post.imageUrls.length === 0 &&
    !post.engagement
  );
}

function isSameFacebookSubmission(
  first: RemoteFacebookPost,
  second: RemoteFacebookPost,
): boolean {
  if (
    remotePostIdentity(first.remoteId) === remotePostIdentity(second.remoteId)
  ) {
    return true;
  }

  const firstMessage = normalizedPostMessage(first);
  const secondMessage = normalizedPostMessage(second);
  const firstTime = postEffectiveTime(first);
  const secondTime = postEffectiveTime(second);
  const hasOneIncompleteRecord =
    isIncompleteSubmission(first) !== isIncompleteSubmission(second);

  return (
    first.mediaType === second.mediaType &&
    firstMessage.length > 0 &&
    firstMessage === secondMessage &&
    firstTime !== null &&
    secondTime !== null &&
    Math.abs(firstTime - secondTime) <= 60_000 &&
    hasOneIncompleteRecord
  );
}

function mergeRemotePosts(posts: RemoteFacebookPost[]): RemoteFacebookPost[] {
  const records: RemoteFacebookPost[] = [];
  for (const post of posts) {
    const existingIndex = records.findIndex((current) =>
      isSameFacebookSubmission(current, post),
    );
    if (existingIndex < 0) {
      records.push(post);
      continue;
    }
    const existing = records[existingIndex]!;
    if (remotePostCompleteness(post) >= remotePostCompleteness(existing)) {
      records[existingIndex] = post;
    }
  }
  return records;
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
    const cachedPosts = mergeRemotePosts(
      cachedRecords
        .map(toRemotePost)
        .filter((post): post is RemoteFacebookPost => post !== null),
    );
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
