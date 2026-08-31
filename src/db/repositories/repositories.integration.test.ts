import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase, runInTransaction } from "@/db/client";
import { FacebookOperationRepository } from "./facebook-operation-repository";
import { PageCredentialRepository } from "./page-credential-repository";
import { PageRepository } from "./page-repository";
import { PostRepository } from "./post-repository";
import { SyncCursorRepository } from "./sync-cursor-repository";
import { UserPageAssignmentRepository } from "./user-page-assignment-repository";
import { AssetRepository } from "./asset-repository";
import { MutationRateLimitRepository } from "./mutation-rate-limit-repository";
import { encryptToken } from "@/lib/crypto/token-crypto";
import {
  appUsers,
  assets,
  facebookOperations,
  posts,
  userPageAssignments,
} from "@/db/schema";

const integrationEnabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!integrationEnabled)("database repositories", () => {
  afterAll(async () => {
    await closeDatabase();
  });

  it("persists related records and rolls the complete unit of work back", async () => {
    const externalPageId = `integration-${randomUUID()}`;
    const rollbackSignal = new Error("EXPECTED_TEST_ROLLBACK");

    await expect(
      runInTransaction(async (transaction) => {
        const pageRepository = new PageRepository(transaction);
        const credentialRepository = new PageCredentialRepository(transaction);
        const postRepository = new PostRepository(transaction);
        const operationRepository = new FacebookOperationRepository(
          transaction,
        );
        const syncCursorRepository = new SyncCursorRepository(transaction);
        const assignmentRepository = new UserPageAssignmentRepository(
          transaction,
        );
        const rateLimits = new MutationRateLimitRepository(transaction);

        const page = await pageRepository.upsertManagedPage({
          externalPageId,
          name: "Integration Test Page",
        });
        const encrypted = encryptToken(
          "integration-page-token",
          randomBytes(32).toString("base64"),
        );
        await credentialRepository.upsert(page.id, encrypted);
        const draft = await postRepository.createDraft({
          pageId: page.id,
          message: "Integration draft",
          type: "text",
        });
        const operation = await operationRepository.createPending({
          pageId: page.id,
          postId: draft.id,
          type: "publish_now",
          requestMetadata: {
            version: 1,
            messageHash: "integration-message-hash",
          },
        });
        const windowStart = new Date("2026-08-16T17:00:00.000Z");
        const windowEnd = new Date("2026-08-23T17:00:00.000Z");
        await postRepository.upsertRemotePosts([
          {
            pageId: page.id,
            remotePostId: `${externalPageId}_remote-1`,
            kind: "published",
            message: "Remote cached post",
            effectiveAt: new Date("2026-08-18T02:00:00.000Z"),
            createdAt: new Date("2026-08-18T02:00:00.000Z"),
            updatedAt: null,
            snapshot: { engagement: { reactions: 1, comments: 0, shares: 0 } },
          },
        ]);
        await syncCursorRepository.markSuccess({
          pageId: page.id,
          syncType: "integration:published:week",
          windowStart,
          windowEnd,
        });

        expect(
          (await credentialRepository.findByPageId(page.id))
            ?.accessTokenCiphertext,
        ).not.toEqual(Buffer.from("integration-page-token"));
        expect(operation.status).toBe("pending");
        expect(operation.requestMetadata).toMatchObject({ version: 1 });
        expect(
          await postRepository.listRemoteWindow(
            page.id,
            "published",
            windowStart,
            windowEnd,
          ),
        ).toHaveLength(1);
        expect(
          await syncCursorRepository.find(
            page.id,
            "integration:published:week",
          ),
        ).toMatchObject({ pageId: page.id });

        const [user] = await transaction
          .insert(appUsers)
          .values({
            email: `integration-${randomUUID()}@example.com`,
            name: "Integration User",
            role: "member",
            approvalStatus: "approved",
          })
          .returning();

        const rateLimitWindowStart = new Date();
        const rateLimitInput = {
          actorId: user!.id,
          pageScope: page.id,
          action: "post:publish",
          windowStart: rateLimitWindowStart,
          expiresAt: new Date(rateLimitWindowStart.getTime() + 60_000),
        };
        expect(await rateLimits.increment(rateLimitInput)).toBe(1);
        expect(await rateLimits.increment(rateLimitInput)).toBe(2);
        await operationRepository.markNeedsAttention(operation.id, {
          reason: "integration_no_match",
          candidates: [],
        });
        expect(await operationRepository.findById(operation.id)).toMatchObject({
          status: "needs_attention",
          resolution: "unresolved",
          resolutionEvidence: { reason: "integration_no_match" },
        });
        await operationRepository.markReconciledFailed({
          id: operation.id,
          evidence: {
            reason: "manual_remote_not_created",
            candidates: [],
          },
          resolvedByUserId: user!.id,
        });
        expect(await operationRepository.findById(operation.id)).toMatchObject({
          status: "failed",
          resolution: "remote_not_created",
          resolvedByUserId: user!.id,
        });
        await transaction.insert(userPageAssignments).values({
          userId: user!.id,
          pageId: page.id,
          assignedByUserId: user!.id,
        });
        await assignmentRepository.deleteForPage(page.id);
        expect(await assignmentRepository.listForUser(user!.id)).toHaveLength(
          0,
        );

        expect(await pageRepository.deactivate(page.id)).toMatchObject({
          id: page.id,
          isActive: false,
        });
        expect(
          (await pageRepository.listActive()).some(
            (activePage) => activePage.id === page.id,
          ),
        ).toBe(false);
        expect(
          await pageRepository.upsertManagedPage({
            externalPageId,
            name: "Reactivated Integration Test Page",
          }),
        ).toMatchObject({ id: page.id, isActive: true });
        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);

    const pageAfterRollback = await new PageRepository(
      getDatabase(),
    ).findByExternalId(externalPageId);
    expect(pageAfterRollback).toBeUndefined();
  });

  it("does not resurrect locally removed remote posts during remote cache sync", async () => {
    const externalPageId = `remote-tombstone-${randomUUID()}`;
    const rollbackSignal = new Error("EXPECTED_TOMBSTONE_TEST_ROLLBACK");

    await expect(
      runInTransaction(async (transaction) => {
        const page = await new PageRepository(transaction).upsertManagedPage({
          externalPageId,
          name: "Remote Tombstone Integration Page",
        });
        const postRepository = new PostRepository(transaction);
        const remotePostId = `${externalPageId}_remote-1`;
        const effectiveAt = new Date("2026-08-18T02:00:00.000Z");
        const windowStart = new Date("2026-08-16T17:00:00.000Z");
        const windowEnd = new Date("2026-08-23T17:00:00.000Z");

        await postRepository.upsertRemotePosts([
          {
            pageId: page.id,
            remotePostId,
            kind: "published",
            message: "Remote post before deletion",
            effectiveAt,
            createdAt: effectiveAt,
            updatedAt: null,
            snapshot: {
              imageUrl: "https://example.test/before.jpg",
              engagement: { reactions: 1, comments: 0, shares: 0 },
            },
          },
        ]);
        const [remotePost] = await postRepository.listRemoteWindow(
          page.id,
          "published",
          windowStart,
          windowEnd,
        );
        expect(remotePost).toBeDefined();

        await postRepository.markRemoteRemoved(
          remotePost!.id,
          page.id,
          remotePostId,
          "published",
        );
        await transaction.insert(facebookOperations).values({
          pageId: page.id,
          postId: remotePost!.id,
          type: "cancel",
          status: "succeeded",
          remotePostId,
          startedAt: new Date("2026-08-18T03:00:00.000Z"),
          finishedAt: new Date("2026-08-18T03:00:01.000Z"),
        });
        expect(
          await postRepository.listRemoteWindow(
            page.id,
            "published",
            windowStart,
            windowEnd,
          ),
        ).toHaveLength(0);

        await transaction
          .update(posts)
          .set({
            status: "published",
            message: "Already resurrected stale row",
            remoteSnapshot: {
              engagement: { reactions: 0, comments: 0, shares: 0 },
            },
          })
          .where(eq(posts.id, remotePost!.id));
        expect(
          await postRepository.listRemoteWindow(
            page.id,
            "published",
            windowStart,
            windowEnd,
          ),
        ).toHaveLength(1);

        await postRepository.upsertRemotePosts([
          {
            pageId: page.id,
            remotePostId,
            kind: "published",
            message: "Stale Facebook stub after deletion",
            effectiveAt,
            createdAt: effectiveAt,
            updatedAt: new Date("2026-08-18T03:00:00.000Z"),
            snapshot: {
              engagement: { reactions: 0, comments: 0, shares: 0 },
            },
          },
        ]);

        expect(
          await postRepository.listRemoteWindow(
            page.id,
            "published",
            windowStart,
            windowEnd,
          ),
        ).toHaveLength(0);
        await expect(
          postRepository.findById(remotePost!.id),
        ).resolves.toMatchObject({
          status: "deleted_remote",
          message: "Already resurrected stale row",
        });

        const videoObjectId = `video-${randomUUID()}`;
        const videoFeedPostId = `${externalPageId}_video-feed`;
        const [videoPost] = await transaction
          .insert(posts)
          .values({
            pageId: page.id,
            remotePostId: videoObjectId,
            type: "video",
            message: "Video before deletion",
            status: "published",
            publishedAt: effectiveAt,
          })
          .returning();
        expect(videoPost).toBeDefined();

        await postRepository.markRemoteRemoved(
          videoPost!.id,
          page.id,
          videoObjectId,
          "published",
          [videoFeedPostId],
        );
        await transaction.insert(facebookOperations).values({
          pageId: page.id,
          postId: videoPost!.id,
          type: "cancel",
          status: "succeeded",
          remotePostId: videoFeedPostId,
          startedAt: new Date("2026-08-18T04:00:00.000Z"),
          finishedAt: new Date("2026-08-18T04:00:01.000Z"),
        });

        await postRepository.upsertRemotePosts([
          {
            pageId: page.id,
            remotePostId: videoFeedPostId,
            kind: "published",
            message: "Stale video feed shell after deletion",
            effectiveAt,
            createdAt: effectiveAt,
            updatedAt: null,
            snapshot: { mediaType: "video" },
          },
        ]);
        const [videoFeedShell] = await transaction
          .select()
          .from(posts)
          .where(eq(posts.remotePostId, videoFeedPostId));
        expect(videoFeedShell).toMatchObject({
          type: "video",
          status: "deleted_remote",
        });

        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);
  });

  it("tombstones both the canonical video feed post and its legacy video object alias", async () => {
    const rollbackSignal = new Error("EXPECTED_VIDEO_ALIAS_TEST_ROLLBACK");

    await expect(
      runInTransaction(async (transaction) => {
        const page = await new PageRepository(transaction).upsertManagedPage({
          externalPageId: `video-alias-${randomUUID()}`,
          name: "Video Alias Integration Page",
        });

        const postRepository = new PostRepository(transaction);
        const effectiveAt = new Date("2026-08-18T02:00:00.000Z");

        const videoObjectId = `video-${randomUUID()}`;
        const feedPostId = `${page.externalPageId}_${randomUUID()}`;

        const [legacyVideoRow] = await transaction
          .insert(posts)
          .values({
            pageId: page.id,
            remotePostId: videoObjectId,
            type: "video",
            message: "Same video",
            status: "published",
            publishedAt: effectiveAt,
          })
          .returning();

        const [canonicalFeedRow] = await transaction
          .insert(posts)
          .values({
            pageId: page.id,
            remotePostId: feedPostId,
            type: "video",
            message: "Same video",
            status: "published",
            publishedAt: effectiveAt,
            remoteSnapshot: {
              mediaType: "video",
              permalinkUrl: "https://facebook.example/video",
            },
          })
          .returning();

        expect(legacyVideoRow).toBeDefined();
        expect(canonicalFeedRow).toBeDefined();

        await postRepository.markRemoteRemoved(
          canonicalFeedRow!.id,
          page.id,
          feedPostId,
          "published",
          [videoObjectId],
        );

        await expect(
          postRepository.findById(canonicalFeedRow!.id),
        ).resolves.toMatchObject({
          remotePostId: feedPostId,
          status: "deleted_remote",
        });

        await expect(
          postRepository.findById(legacyVideoRow!.id),
        ).resolves.toMatchObject({
          remotePostId: videoObjectId,
          status: "deleted_remote",
        });

        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);
  });

  it("marks an old missing remote post deleted but preserves a recent post inside the visibility grace period", async () => {
    const rollbackSignal = new Error("EXPECTED_MISSING_REMOTE_TEST_ROLLBACK");

    await expect(
      runInTransaction(async (transaction) => {
        const page = await new PageRepository(transaction).upsertManagedPage({
          externalPageId: `missing-remote-${randomUUID()}`,
          name: "Missing Remote Integration Page",
        });

        const postRepository = new PostRepository(transaction);

        const windowStart = new Date("2026-08-16T17:00:00.000Z");
        const windowEnd = new Date("2026-08-23T17:00:00.000Z");
        const missingGraceBefore = new Date("2026-08-23T16:50:00.000Z");

        const oldRemotePostId = `old-${randomUUID()}`;
        const recentRemotePostId = `recent-${randomUUID()}`;

        const [oldPost] = await transaction
          .insert(posts)
          .values({
            pageId: page.id,
            remotePostId: oldRemotePostId,
            type: "text",
            message: "Old remote post no longer on Facebook",
            status: "published",
            publishedAt: new Date("2026-08-18T02:00:00.000Z"),
            updatedAt: new Date("2026-08-18T03:00:00.000Z"),
          })
          .returning();

        const [recentPost] = await transaction
          .insert(posts)
          .values({
            pageId: page.id,
            remotePostId: recentRemotePostId,
            type: "text",
            message: "Fresh post still inside Meta visibility grace",
            status: "published",
            publishedAt: new Date("2026-08-23T16:45:00.000Z"),
            updatedAt: new Date("2026-08-23T16:55:00.000Z"),
          })
          .returning();

        expect(oldPost).toBeDefined();
        expect(recentPost).toBeDefined();

        await postRepository.markMissingRemotePosts({
          pageId: page.id,
          kind: "published",
          windowStart,
          windowEnd,
          seenRemotePostIds: [],
          missingGraceBefore,
        });

        await expect(
          postRepository.findById(oldPost!.id),
        ).resolves.toMatchObject({
          remotePostId: oldRemotePostId,
          status: "deleted_remote",
        });

        await expect(
          postRepository.findById(recentPost!.id),
        ).resolves.toMatchObject({
          remotePostId: recentRemotePostId,
          status: "published",
        });

        const activePosts = await postRepository.listRemoteWindow(
          page.id,
          "published",
          windowStart,
          windowEnd,
        );

        expect(activePosts.map((post) => post.remotePostId)).toContain(
          recentRemotePostId,
        );

        expect(activePosts.map((post) => post.remotePostId)).not.toContain(
          oldRemotePostId,
        );

        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);
  });

  it("selects successful images, aged successful videos, and orphaned assets for cleanup", async () => {
    const rollbackSignal = new Error("EXPECTED_CLEANUP_TEST_ROLLBACK");

    await expect(
      runInTransaction(async (transaction) => {
        const page = await new PageRepository(transaction).upsertManagedPage({
          externalPageId: `cleanup-${randomUUID()}`,
          name: "Cleanup Integration Page",
        });
        const postRepository = new PostRepository(transaction);
        const assetRepository = new AssetRepository(transaction);
        const now = new Date("2026-08-22T04:00:00.000Z");
        const oldCreatedAt = new Date("2026-08-01T00:00:00.000Z");

        async function createAsset(label: string, mimeType = "image/jpeg") {
          const extension = mimeType.startsWith("video/") ? "mp4" : "jpg";
          const [record] = await transaction
            .insert(assets)
            .values({
              pageId: page.id,
              storageKey: `integration-cleanup/${randomUUID()}-${label}.${extension}`,
              mimeType,
              fileSize: 1024,
              checksum: randomBytes(32).toString("hex"),
              originalFilename: `${label}.${extension}`,
              createdAt: oldCreatedAt,
            })
            .returning();
          return record!;
        }

        async function createAttached(label: string, mimeType = "image/jpeg") {
          const asset = await createAsset(label, mimeType);
          const post = await postRepository.createDraft({
            pageId: page.id,
            message: label,
            type: mimeType.startsWith("video/") ? "video" : "image",
            assetIds: [asset.id],
          });
          return { asset, post };
        }

        async function markRemoteSuccess(input: {
          postId: string;
          status: "published" | "scheduled";
          finishedAt: Date;
        }) {
          const remotePostId = `remote-${randomUUID()}`;
          await transaction
            .update(posts)
            .set({
              status: input.status,
              remotePostId,
              publishedAt:
                input.status === "published" ? input.finishedAt : null,
              scheduledAt:
                input.status === "scheduled"
                  ? new Date("2026-08-30T04:00:00.000Z")
                  : null,
            })
            .where(eq(posts.id, input.postId));
          await transaction.insert(facebookOperations).values({
            pageId: page.id,
            postId: input.postId,
            type: input.status === "scheduled" ? "schedule" : "publish_now",
            status: "succeeded",
            remotePostId,
            startedAt: new Date(input.finishedAt.getTime() - 1_000),
            finishedAt: input.finishedAt,
          });
        }

        const publishedImage = await createAttached("published-image");
        await markRemoteSuccess({
          postId: publishedImage.post.id,
          status: "published",
          finishedAt: new Date("2026-08-22T03:50:00.000Z"),
        });

        const scheduledImage = await createAttached("scheduled-image");
        await markRemoteSuccess({
          postId: scheduledImage.post.id,
          status: "scheduled",
          finishedAt: new Date("2026-08-22T03:55:00.000Z"),
        });

        const agedVideo = await createAttached("aged-video", "video/mp4");
        await markRemoteSuccess({
          postId: agedVideo.post.id,
          status: "scheduled",
          finishedAt: new Date("2026-08-21T03:00:00.000Z"),
        });

        const freshVideo = await createAttached("fresh-video", "video/mp4");
        await markRemoteSuccess({
          postId: freshVideo.post.id,
          status: "published",
          finishedAt: new Date("2026-08-22T02:00:00.000Z"),
        });

        const publishedWithoutOperation = await createAttached(
          "published-without-operation",
        );
        await transaction
          .update(posts)
          .set({
            status: "published",
            remotePostId: `remote-${randomUUID()}`,
            publishedAt: new Date("2026-08-14T04:00:00.000Z"),
          })
          .where(eq(posts.id, publishedWithoutOperation.post.id));

        const failed = await createAttached("failed");
        await postRepository.markSubmissionFailed(
          failed.post.id,
          "TEST_FAILED",
          "failed",
        );

        const uncertain = await createAttached("uncertain");
        await postRepository.markSubmissionUncertain(
          uncertain.post.id,
          "TEST_UNCERTAIN",
        );

        const draft = await createAttached("draft");
        const galleryAssets = [
          await createAsset("gallery-one"),
          await createAsset("gallery-two"),
        ];
        const gallery = await postRepository.createDraft({
          pageId: page.id,
          message: "gallery",
          type: "image",
          assetIds: galleryAssets.map((asset) => asset.id),
        });
        await assetRepository.setRemoteMediaIds(gallery.id, [
          "remote-photo-1",
          "remote-photo-2",
        ]);
        expect(
          (await assetRepository.listForPost(gallery.id)).map((asset) => ({
            sortOrder: asset.sortOrder,
            remoteMediaId: asset.remoteMediaId,
          })),
        ).toEqual([
          { sortOrder: 0, remoteMediaId: "remote-photo-1" },
          { sortOrder: 1, remoteMediaId: "remote-photo-2" },
        ]);
        const orphan = await createAsset("orphan");
        const window = {
          successfulImageBefore: now,
          successfulVideoBefore: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          orphanedBefore: new Date(now.getTime() - 60 * 60 * 1000),
          claimStaleBefore: new Date(now.getTime() - 15 * 60 * 1000),
        };
        const candidates = await assetRepository.listCleanupCandidates(
          window,
          50,
        );
        const candidateIds = new Set(candidates.map((asset) => asset.id));

        expect(candidateIds).toEqual(
          new Set([
            publishedImage.asset.id,
            scheduledImage.asset.id,
            agedVideo.asset.id,
            orphan.id,
          ]),
        );
        expect(candidateIds.has(freshVideo.asset.id)).toBe(false);
        expect(candidateIds.has(publishedWithoutOperation.asset.id)).toBe(
          false,
        );
        expect(candidateIds.has(failed.asset.id)).toBe(false);
        expect(candidateIds.has(uncertain.asset.id)).toBe(false);
        expect(candidateIds.has(draft.asset.id)).toBe(false);
        expect(candidateIds.has(galleryAssets[0]!.id)).toBe(false);
        expect(candidateIds.has(galleryAssets[1]!.id)).toBe(false);

        const claimedAt = new Date("2026-08-22T04:00:01.000Z");
        expect(
          await assetRepository.claimForCleanup(
            publishedImage.asset.id,
            window,
            claimedAt,
          ),
        ).toMatchObject({ cleanupClaimedAt: claimedAt, deletedAt: null });
        expect(
          await assetRepository.restoreCleanupClaim(
            publishedImage.asset.id,
            claimedAt,
          ),
        ).toBe(true);

        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);
  }, 15_000);
});
