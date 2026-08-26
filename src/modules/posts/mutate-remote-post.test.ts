import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import {
  RemotePostMutationService,
  type RemotePostMutationClient,
  type RemotePostMutationPersistence,
} from "./mutate-remote-post";

const postId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";

const prepared = {
  operationId: "operation-1",
  postId,
  pageId: "018f0d44-35f0-7b63-99d2-c1b9222cd06e",
  remotePostId: "page-1_122191964246910216",

  /*
   * Text/image bình thường trong test này
   * không cần media alias.
   *
   * Video mới sẽ override field này
   * thành [videoObjectId].
   */
  remoteMediaIds: [] as string[],

  postType: "image" as const,
  status: "scheduled" as const,
  pageAccessToken: "decrypted-token",
};

function setup() {
  const persistence: RemotePostMutationPersistence = {
    prepare: vi.fn().mockResolvedValue(prepared),

    updateSucceeded: vi.fn().mockResolvedValue(undefined),

    removeSucceeded: vi.fn().mockResolvedValue(undefined),

    fail: vi.fn().mockResolvedValue(undefined),

    uncertain: vi.fn().mockResolvedValue(undefined),
  };

  const client: RemotePostMutationClient = {
    updatePostMessage: vi.fn().mockResolvedValue(undefined),

    deletePost: vi.fn().mockResolvedValue(undefined),

    resolveVideoPostId: vi.fn().mockResolvedValue(null),
  };

  const clientFactory = vi.fn().mockReturnValue(client);

  const service = new RemotePostMutationService(persistence, clientFactory);

  return {
    persistence,
    client,
    clientFactory,
    service,
  };
}

describe("RemotePostMutationService", () => {
  it("updates a remote post message and persists only after Meta succeeds", async () => {
    const context = setup();

    await expect(
      context.service.updateMessage(postId, "Caption mới"),
    ).resolves.toEqual({
      operationId: "operation-1",
      postId,
      remotePostId: prepared.remotePostId,
      status: "succeeded",
    });

    expect(context.clientFactory).toHaveBeenCalledWith("decrypted-token");

    expect(context.client.updatePostMessage).toHaveBeenCalledWith(
      prepared.remotePostId,
      "Caption mới",
    );

    expect(context.persistence.updateSucceeded).toHaveBeenCalledWith({
      ...prepared,
      message: "Caption mới",
    });

    expect(context.persistence.fail).not.toHaveBeenCalled();
  });

  it("removes a scheduled or published remote post and records the previous status", async () => {
    const context = setup();

    await expect(context.service.remove(postId)).resolves.toEqual({
      operationId: "operation-1",
      postId,
      remotePostId: prepared.remotePostId,
      previousStatus: "scheduled",
      status: "succeeded",
    });

    expect(context.client.deletePost).toHaveBeenCalledWith(
      prepared.remotePostId,
    );

    expect(context.client.resolveVideoPostId).not.toHaveBeenCalled();

    expect(context.persistence.removeSucceeded).toHaveBeenCalledWith({
      ...prepared,
      deletedRemotePostId: prepared.remotePostId,
    });
  });

  /*
   * LEGACY VIDEO CASE
   *
   * Dữ liệu cũ:
   *
   * posts.remotePostId = Video Object ID
   *
   * Khi delete:
   * Video ID
   *   ↓
   * resolveVideoPostId()
   *   ↓
   * Feed Post ID
   *   ↓
   * DELETE Feed Post ID
   */
  it("deletes a legacy video through its associated feed post id", async () => {
    const context = setup();

    const video = {
      ...prepared,

      // Legacy row lưu Video Object ID
      remotePostId: "122191964246910216",

      // Legacy row có thể chưa lưu media alias
      remoteMediaIds: [],

      postType: "video" as const,
    };

    vi.mocked(context.persistence.prepare).mockResolvedValue(video);

    vi.mocked(context.client.resolveVideoPostId).mockResolvedValue(
      "page-1_122191964246910216",
    );

    await expect(context.service.remove(postId)).resolves.toMatchObject({
      status: "succeeded",
      remotePostId: video.remotePostId,
    });

    expect(context.client.resolveVideoPostId).toHaveBeenCalledWith(
      video.remotePostId,
    );

    expect(context.client.deletePost).toHaveBeenCalledWith(
      "page-1_122191964246910216",
    );

    expect(context.persistence.removeSucceeded).toHaveBeenCalledWith({
      ...video,
      deletedRemotePostId: "page-1_122191964246910216",
    });
  });

  /*
   * NEW VIDEO CASE
   *
   * Sau fix submit-post:
   *
   * posts.remotePostId
   *   = Feed / Page Post ID
   *
   * post_assets.remoteMediaId
   *   = Video Object ID
   *
   * Service KHÔNG cần resolve nữa vì
   * remotePostId đã là canonical Feed Post ID.
   *
   * Nhưng remoteMediaIds phải được giữ lại
   * để persistence tombstone cả Video ID alias.
   */
  it("deletes a canonical video post while preserving its video object id alias", async () => {
    const context = setup();

    const videoObjectId = "122191964246910216";

    const feedPostId = "page-1_122191964246910216";

    const video = {
      ...prepared,
      remotePostId: feedPostId,
      remoteMediaIds: [videoObjectId],
      postType: "video" as const,
      status: "published" as const,
    };

    vi.mocked(context.persistence.prepare).mockResolvedValue(video);

    await expect(context.service.remove(postId)).resolves.toEqual({
      operationId: "operation-1",
      postId,
      remotePostId: feedPostId,
      previousStatus: "published",
      status: "succeeded",
    });

    /*
     * Feed Post ID đã canonical rồi,
     * không được resolveVideoPostId().
     */
    expect(context.client.resolveVideoPostId).not.toHaveBeenCalled();

    /*
     * DELETE đúng Feed Post ID.
     */
    expect(context.client.deletePost).toHaveBeenCalledWith(feedPostId);

    /*
     * Quan trọng nhất:
     *
     * persistence vẫn nhận được
     * remoteMediaIds: [Video Object ID].
     *
     * Database persistence sau đó sẽ đưa
     * Video ID này vào markRemoteRemoved()
     * làm alias để tombstone row ghost.
     */
    expect(context.persistence.removeSucceeded).toHaveBeenCalledWith({
      ...video,
      deletedRemotePostId: feedPostId,
    });
  });

  it("records a known Meta rejection as failed", async () => {
    const context = setup();

    vi.mocked(context.client.updatePostMessage).mockRejectedValue(
      new AppError({
        code: "FACEBOOK_PERMISSION_DENIED",
        message: "Token mất quyền.",
        status: 403,
      }),
    );

    await expect(
      context.service.updateMessage(postId, "Caption mới"),
    ).rejects.toMatchObject({
      code: "FACEBOOK_PERMISSION_DENIED",
    });

    expect(context.persistence.fail).toHaveBeenCalledWith(
      "operation-1",
      "FACEBOOK_PERMISSION_DENIED",
      "Token mất quyền.",
    );

    expect(context.persistence.uncertain).not.toHaveBeenCalled();
  });

  it("marks a retryable remote failure as uncertain and does not persist success", async () => {
    const context = setup();

    vi.mocked(context.client.deletePost).mockRejectedValue(
      new AppError({
        code: "FACEBOOK_NETWORK_ERROR",
        message: "Timeout",
        retryable: true,
      }),
    );

    await expect(context.service.remove(postId)).rejects.toMatchObject({
      code: "FACEBOOK_NETWORK_ERROR",
    });

    expect(context.persistence.uncertain).toHaveBeenCalledWith(
      "operation-1",
      "FACEBOOK_NETWORK_ERROR",
    );

    expect(context.persistence.removeSucceeded).not.toHaveBeenCalled();
  });

  it("does not label Meta success as failure when local persistence fails", async () => {
    const context = setup();

    vi.mocked(context.persistence.updateSucceeded).mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      context.service.updateMessage(postId, "Caption mới"),
    ).rejects.toMatchObject({
      code: "REMOTE_SUCCESS_LOCAL_PERSIST_FAILED",
    });

    expect(context.client.updatePostMessage).toHaveBeenCalledOnce();

    expect(context.persistence.uncertain).toHaveBeenCalledWith(
      "operation-1",
      "REMOTE_SUCCESS_LOCAL_PERSIST_FAILED",
    );

    expect(context.persistence.fail).not.toHaveBeenCalled();
  });
});
