import { describe, expect, it } from "vitest";
import type { RemoteFacebookPost } from "./remote-post-reader";
import { toRemotePostCacheInput } from "./remote-post-mirror";

describe("toRemotePostCacheInput", () => {
  it("preserves video object aliases in the remote snapshot", () => {
    const post: RemoteFacebookPost = {
      localPostId: null,
      remoteId: "page-123_feed-post-1",
      kind: "published",
      message: "Video post",
      effectiveAt: "2026-08-21T02:00:00.000Z",
      createdAt: "2026-08-21T02:00:00.000Z",
      updatedAt: null,
      permalinkUrl: null,
      imageUrl: null,
      imageUrls: [],
      remoteMediaIds: ["video-object-1"],
      mediaType: "video",
      engagement: null,
      source: "facebook",
    };

    expect(toRemotePostCacheInput("local-page-1", post).snapshot).toMatchObject(
      {
        remoteMediaIds: ["video-object-1"],
      },
    );
  });
});
