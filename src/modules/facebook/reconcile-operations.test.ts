import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { FacebookOperationRecord } from "@/db/repositories/facebook-operation-repository";
import type { PostRecord } from "@/db/repositories/post-repository";
import type { RemoteFacebookPost } from "./remote-post-reader";
import { ReconcileFacebookOperationService } from "./reconcile-operations";

const operationId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";
const postId = "018f0d44-35f0-7b63-99d2-c1b9222cd05e";
const pageId = "018f0d44-35f0-7b63-99d2-c1b9222cd05f";
const actorId = "018f0d44-35f0-7b63-99d2-c1b9222cd060";
const startedAt = new Date("2026-08-25T00:00:00.000Z");
const now = new Date("2026-08-25T00:15:00.000Z");
const message = "Nội dung cần đối soát";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function makePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: postId,
    pageId,
    remotePostId: null,
    type: "text",
    message,
    status: "uncertain",
    scheduledAt: null,
    publishedAt: null,
    remoteCreatedAt: null,
    remoteUpdatedAt: null,
    lastSyncedAt: null,
    remoteSnapshot: {},
    lastErrorCode: "FACEBOOK_NETWORK_ERROR",
    lastErrorMessage: "Cần đối soát",
    createdAt: startedAt,
    updatedAt: startedAt,
    ...overrides,
  };
}

function makeOperation(
  overrides: Partial<FacebookOperationRecord> = {},
): FacebookOperationRecord {
  return {
    id: operationId,
    pageId,
    postId,
    type: "publish_now",
    status: "uncertain",
    remotePostId: null,
    requestFingerprint: "fingerprint-1",
    requestMetadata: {
      version: 1,
      messageHash: hash(message),
      postType: "text",
      assetCount: 0,
      scheduledFor: null,
    },
    httpStatus: null,
    providerErrorCode: "FACEBOOK_NETWORK_ERROR",
    providerErrorMessage: null,
    providerRequestId: null,
    startedAt,
    finishedAt: startedAt,
    durationMs: null,
    resolution: null,
    resolutionEvidence: {},
    resolvedByUserId: null,
    resolvedAt: null,
    ...overrides,
  };
}

function makeRemote(
  remoteId: string,
  overrides: Partial<RemoteFacebookPost> = {},
): RemoteFacebookPost {
  return {
    remoteId,
    kind: "published",
    message,
    effectiveAt: "2026-08-25T00:01:00.000Z",
    createdAt: "2026-08-25T00:01:00.000Z",
    updatedAt: null,
    permalinkUrl: null,
    imageUrl: null,
    imageUrls: [],
    mediaType: "text",
    engagement: null,
    source: "facebook",
    ...overrides,
  };
}

function setup(input?: {
  operation?: FacebookOperationRecord;
  post?: PostRecord;
  remotePosts?: RemoteFacebookPost[];
  currentTime?: Date;
}) {
  const record = {
    operation: input?.operation ?? makeOperation(),
    post: input?.post ?? makePost(),
    assetCount: input?.post?.type === "image" ? 2 : 0,
  };
  const persistence = {
    load: vi.fn().mockResolvedValue(record),
    list: vi.fn().mockResolvedValue([record]),
    needsAttention: vi.fn().mockResolvedValue(undefined),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const reader = {
    list: vi.fn().mockResolvedValue({
      page: {
        id: pageId,
        externalPageId: "external-page",
        name: "Page test",
        avatarUrl: null,
        timezone: "Asia/Ho_Chi_Minh",
      },
      posts: input?.remotePosts ?? [],
      after: null,
      fetchedAt: now.toISOString(),
    }),
  };
  const service = new ReconcileFacebookOperationService(
    persistence,
    reader,
    () => input?.currentTime ?? now,
  );
  return { record, persistence, reader, service };
}

describe("ReconcileFacebookOperationService", () => {
  it("recovers remote success after a local timeout from one exact candidate", async () => {
    const setupResult = setup({
      operation: makeOperation({ status: "pending", finishedAt: null }),
      post: makePost({ status: "submitting" }),
      remotePosts: [makeRemote("page_remote-1")],
    });

    await expect(setupResult.service.reconcile(operationId)).resolves.toEqual({
      operationId,
      postId,
      status: "succeeded",
      resolution: "remote_created",
      remotePostId: "page_remote-1",
      reason: "unique_match",
    });
    expect(setupResult.persistence.succeed).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "publish_now",
        remotePostId: "page_remote-1",
        effectiveAt: new Date("2026-08-25T00:01:00.000Z"),
      }),
    );
    expect(setupResult.persistence.fail).not.toHaveBeenCalled();
  });

  it("resolves an exact native schedule using message and schedule evidence", async () => {
    const scheduledFor = "2026-08-25T08:00:00.000Z";
    const setupResult = setup({
      operation: makeOperation({
        type: "schedule",
        requestMetadata: {
          version: 1,
          messageHash: hash(message),
          postType: "image",
          assetCount: 2,
          scheduledFor,
        },
      }),
      post: makePost({ type: "image" }),
      remotePosts: [
        makeRemote("scheduled-1", {
          kind: "scheduled",
          mediaType: "image",
          imageUrl: "https://example.com/cover.jpg",
          imageUrls: ["https://example.com/cover.jpg"],
          effectiveAt: scheduledFor,
          createdAt: "2026-08-25T00:00:30.000Z",
        }),
      ],
    });

    await setupResult.service.reconcile(operationId);

    expect(setupResult.reader.list).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "scheduled", window: undefined }),
    );
    expect(setupResult.persistence.succeed).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "schedule",
        remotePostId: "scheduled-1",
        effectiveAt: new Date(scheduledFor),
      }),
    );
  });

  it("moves an empty remote result to needs_attention without retrying create", async () => {
    const setupResult = setup();

    await expect(setupResult.service.reconcile(operationId)).resolves.toEqual(
      expect.objectContaining({
        status: "needs_attention",
        resolution: "unresolved",
        reason: "no_match",
      }),
    );
    expect(setupResult.persistence.needsAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          reason: "no_match",
          candidates: [],
        }),
      }),
    );
    expect(setupResult.persistence.succeed).not.toHaveBeenCalled();
    expect(setupResult.persistence.fail).not.toHaveBeenCalled();
  });

  it("does not conclude no_match while Facebook's visibility window is still open", async () => {
    const setupResult = setup({
      currentTime: new Date("2026-08-25T00:05:00.000Z"),
    });

    await expect(setupResult.service.reconcile(operationId)).resolves.toEqual(
      expect.objectContaining({
        status: "needs_attention",
        reason: "visibility_window_open",
      }),
    );
    expect(setupResult.persistence.needsAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          reason: "visibility_window_open",
        }),
      }),
    );
  });

  it("does not accept a unique candidate until the remote scan is complete", async () => {
    const setupResult = setup({ remotePosts: [makeRemote("remote-1")] });
    setupResult.reader.list.mockResolvedValue({
      page: {
        id: pageId,
        externalPageId: "external-page",
        name: "Page test",
        avatarUrl: null,
        timezone: "Asia/Ho_Chi_Minh",
      },
      posts: [makeRemote("remote-1")],
      after: "still-has-more",
      fetchedAt: now.toISOString(),
    });

    await expect(setupResult.service.reconcile(operationId)).resolves.toEqual(
      expect.objectContaining({
        status: "needs_attention",
        reason: "scan_incomplete",
      }),
    );
    expect(setupResult.reader.list).toHaveBeenCalledTimes(5);
    expect(setupResult.persistence.succeed).not.toHaveBeenCalled();
  });

  it("requires attention when multiple remote posts match", async () => {
    const setupResult = setup({
      remotePosts: [makeRemote("remote-1"), makeRemote("remote-2")],
    });

    await expect(setupResult.service.reconcile(operationId)).resolves.toEqual(
      expect.objectContaining({
        status: "needs_attention",
        reason: "ambiguous_match",
      }),
    );
    expect(setupResult.persistence.needsAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          candidates: [
            expect.objectContaining({ remotePostId: "remote-1" }),
            expect.objectContaining({ remotePostId: "remote-2" }),
          ],
        }),
      }),
    );
  });

  it("does not hide a database failure after unique remote evidence", async () => {
    const setupResult = setup({ remotePosts: [makeRemote("remote-1")] });
    setupResult.persistence.succeed.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      setupResult.service.reconcile(operationId),
    ).rejects.toMatchObject({ code: "RECONCILIATION_LOCAL_PERSIST_FAILED" });
    expect(setupResult.persistence.fail).not.toHaveBeenCalled();
  });

  it("allows Admin to resolve remote_not_created only after no-match evidence", async () => {
    const setupResult = setup({
      operation: makeOperation({
        status: "needs_attention",
        resolution: "unresolved",
        resolutionEvidence: {
          version: 1,
          reason: "no_match",
          checkedAt: now.toISOString(),
          candidates: [],
        },
      }),
    });

    await expect(
      setupResult.service.resolveManually({
        operationId,
        actorUserId: actorId,
        resolution: {
          resolution: "remote_not_created",
          note: "Đã kiểm tra Business Suite và không có bài tương ứng.",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "failed",
        resolution: "remote_not_created",
      }),
    );
    expect(setupResult.persistence.fail).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedByUserId: actorId }),
    );
  });

  it("lets Admin choose only a current candidate returned by Facebook", async () => {
    const setupResult = setup({
      operation: makeOperation({
        status: "needs_attention",
        resolution: "unresolved",
        resolutionEvidence: {
          version: 1,
          reason: "ambiguous_match",
          candidates: [
            { remotePostId: "remote-1" },
            { remotePostId: "remote-2" },
          ],
        },
      }),
      remotePosts: [makeRemote("remote-1"), makeRemote("remote-2")],
    });

    await setupResult.service.resolveManually({
      operationId,
      actorUserId: actorId,
      resolution: {
        resolution: "remote_created",
        remotePostId: "remote-2",
        note: "Đã đối chiếu thời gian và nội dung trong Business Suite.",
      },
    });

    expect(setupResult.persistence.succeed).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePostId: "remote-2",
        resolvedByUserId: actorId,
      }),
    );
  });

  it("refuses to reconcile a fresh pending operation", async () => {
    const setupResult = setup({
      operation: makeOperation({
        status: "pending",
        startedAt: new Date("2026-08-25T00:14:00.000Z"),
        finishedAt: null,
      }),
      post: makePost({ status: "submitting" }),
    });

    await expect(
      setupResult.service.reconcile(operationId),
    ).rejects.toMatchObject({ code: "FACEBOOK_OPERATION_NOT_REVIEWABLE" });
    expect(setupResult.reader.list).not.toHaveBeenCalled();
  });
});
