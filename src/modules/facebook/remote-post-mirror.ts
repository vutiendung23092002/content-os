import "server-only";

import { runInTransaction } from "@/db/client";
import {
  PostRepository,
  type RemotePostCacheInput,
} from "@/db/repositories/post-repository";
import type {
  RemoteFacebookPost,
  RemotePostKind,
} from "./remote-post-reader";

const MISSING_REMOTE_GRACE_MS = 10 * 60 * 1000;

function toCacheInput(
  pageId: string,
  post: RemoteFacebookPost,
): RemotePostCacheInput {
  return {
    pageId,
    remotePostId: post.remoteId,
    kind: post.kind,
    message: post.message,
    effectiveAt: post.effectiveAt
      ? new Date(post.effectiveAt)
      : null,
    createdAt: post.createdAt
      ? new Date(post.createdAt)
      : null,
    updatedAt: post.updatedAt
      ? new Date(post.updatedAt)
      : null,
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

function dedupeRemotePosts(
  posts: RemoteFacebookPost[],
): RemoteFacebookPost[] {
  const byRemoteId = new Map<string, RemoteFacebookPost>();

  for (const post of posts) {
    byRemoteId.set(post.remoteId, post);
  }

  return [...byRemoteId.values()];
}

export class RemotePostMirror {
  constructor(
    private readonly now: () => Date = () => new Date(),
  ) {}

  async replaceWindow(input: {
    pageId: string;
    kind: RemotePostKind;
    windowStart: Date;
    windowEnd: Date;
    posts: RemoteFacebookPost[];
  }): Promise<{
    mirrored: number;
    tombstoned: number;
  }> {
    const now = this.now();

    const remotePosts = dedupeRemotePosts(input.posts);

    const seenRemotePostIds = remotePosts.map(
      (post) => post.remoteId,
    );

    return runInTransaction(async (transaction) => {
      const repository =
        new PostRepository(transaction);

      await repository.upsertRemotePosts(
        remotePosts.map((post) =>
          toCacheInput(input.pageId, post),
        ),
      );

      const tombstoned =
        await repository.markMissingRemotePosts({
          pageId: input.pageId,
          kind: input.kind,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          seenRemotePostIds,
          missingGraceBefore: new Date(
            now.getTime() -
              MISSING_REMOTE_GRACE_MS,
          ),
        });

      return {
        mirrored: remotePosts.length,
        tombstoned,
      };
    });
  }
}