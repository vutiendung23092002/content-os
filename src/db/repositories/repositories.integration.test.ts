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
import { encryptToken } from "@/lib/crypto/token-crypto";
import { appUsers, assets, posts, userPageAssignments } from "@/db/schema";

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

  it("only selects old published and orphaned assets for cleanup", async () => {
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

        async function createAsset(label: string) {
          const [record] = await transaction
            .insert(assets)
            .values({
              pageId: page.id,
              storageKey: `integration-cleanup/${randomUUID()}-${label}.jpg`,
              mimeType: "image/jpeg",
              fileSize: 1024,
              checksum: randomBytes(32).toString("hex"),
              originalFilename: `${label}.jpg`,
              createdAt: oldCreatedAt,
            })
            .returning();
          return record!;
        }

        async function createAttached(label: string) {
          const asset = await createAsset(label);
          const post = await postRepository.createDraft({
            pageId: page.id,
            message: label,
            type: "image",
            assetIds: [asset.id],
          });
          return { asset, post };
        }

        const oldPublished = await createAttached("old-published");
        await transaction
          .update(posts)
          .set({
            status: "published",
            remotePostId: `remote-${randomUUID()}`,
            publishedAt: new Date("2026-08-14T04:00:00.000Z"),
          })
          .where(eq(posts.id, oldPublished.post.id));

        const recentPublished = await createAttached("recent-published");
        await transaction
          .update(posts)
          .set({
            status: "published",
            remotePostId: `remote-${randomUUID()}`,
            publishedAt: new Date("2026-08-16T04:00:00.000Z"),
          })
          .where(eq(posts.id, recentPublished.post.id));

        const scheduled = await createAttached("scheduled");
        await transaction
          .update(posts)
          .set({
            status: "scheduled",
            remotePostId: `remote-${randomUUID()}`,
            scheduledAt: new Date("2026-08-10T04:00:00.000Z"),
          })
          .where(eq(posts.id, scheduled.post.id));

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
        const orphan = await createAsset("orphan");
        const window = {
          publishedBefore: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          orphanedBefore: new Date(now.getTime() - 60 * 60 * 1000),
          claimStaleBefore: new Date(now.getTime() - 15 * 60 * 1000),
        };
        const candidates = await assetRepository.listCleanupCandidates(
          window,
          50,
        );
        const candidateIds = new Set(candidates.map((asset) => asset.id));

        expect(candidateIds).toEqual(
          new Set([oldPublished.asset.id, orphan.id]),
        );
        expect(candidateIds.has(recentPublished.asset.id)).toBe(false);
        expect(candidateIds.has(scheduled.asset.id)).toBe(false);
        expect(candidateIds.has(failed.asset.id)).toBe(false);
        expect(candidateIds.has(uncertain.asset.id)).toBe(false);
        expect(candidateIds.has(draft.asset.id)).toBe(false);

        const claimedAt = new Date("2026-08-22T04:00:01.000Z");
        expect(
          await assetRepository.claimForCleanup(
            oldPublished.asset.id,
            window,
            claimedAt,
          ),
        ).toMatchObject({ cleanupClaimedAt: claimedAt, deletedAt: null });
        expect(
          await assetRepository.restoreCleanupClaim(
            oldPublished.asset.id,
            claimedAt,
          ),
        ).toBe(true);

        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);
  });
});
