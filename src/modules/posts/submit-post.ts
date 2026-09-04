import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { runInTransaction } from "@/db/client";
import { FacebookOperationRepository } from "@/db/repositories/facebook-operation-repository";
import { AssetRepository } from "@/db/repositories/asset-repository";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import { PostRepository } from "@/db/repositories/post-repository";
import { AppError } from "@/lib/errors/app-error";
import type { MetaPostSubmissionReceipt } from "@/modules/facebook/meta-client";
import {
  assertPageReadyForMutation,
  getPageCredentialIncidentStatus,
  isPageCredentialExpired,
  pageCredentialExpiredError,
  recordExpiredPageCredential,
  recordPageCredentialIncident,
  type PageCredentialIncidentStatus,
} from "@/modules/facebook/credential-incident";
import {
  createMetaClientFromCredential,
  toStoredPageToken,
  type StoredPageToken,
} from "@/modules/facebook/page-credential";
import { AssetStorage } from "@/modules/assets/asset-storage";
import { parseFacebookScheduleTime } from "./schedule-window";

export type SubmissionKind = "publish_now" | "schedule";

export type PreparedSubmission = {
  operationId: string;
  postId: string;
  pageId: string;
  externalPageId: string;
  message: string;
  postType: "text" | "image" | "video";
  pageCredential: StoredPageToken;
  media: Array<{ assetId: string; storageKey: string; mimeType: string }>;
};

export type SubmissionPersistence = {
  prepare(input: {
    postId: string;
    kind: SubmissionKind;
    requestFingerprint: string;
    scheduledFor?: Date;
    actorUserId?: string;
  }): Promise<PreparedSubmission>;
  succeed(input: {
    operationId: string;
    postId: string;
    remotePostId: string;
    remoteMediaIds: string[];
    kind: SubmissionKind;
    scheduledFor?: Date;
    actorUserId?: string;
  }): Promise<void>;
  fail(input: {
    operationId: string;
    postId: string;
    pageId: string;
    code: string;
    message: string;
    uncertain: boolean;
    credentialIncident?: PageCredentialIncidentStatus;
    credentialId?: string;
    facebookConnectionId?: string | null;
  }): Promise<void>;
};

export type SubmissionMetaClient = {
  publishPost(input: {
    pageId: string;
    message: string;
    mediaUrls?: string[];
  }): Promise<MetaPostSubmissionReceipt>;
  schedulePost(input: {
    pageId: string;
    message: string;
    scheduledFor: Date;
    mediaUrls?: string[];
  }): Promise<MetaPostSubmissionReceipt>;
  publishVideo(input: {
    pageId: string;
    description: string;
    fileUrl: string;
  }): Promise<string>;
  scheduleVideo(input: {
    pageId: string;
    description: string;
    fileUrl: string;
    scheduledFor: Date;
  }): Promise<string>;
  resolveVideoPostId(videoId: string): Promise<string | null>;
};

export type SubmissionAssetUrlProvider = {
  createSignedUrls(storageKeys: string[]): Promise<string[]>;
};

export type SubmissionResult = {
  operationId: string;
  postId: string;
  remotePostId: string;
  status: "published" | "scheduled";
  scheduledFor?: string;
};

class DatabaseSubmissionPersistence implements SubmissionPersistence {
  async prepare(input: {
    postId: string;
    kind: SubmissionKind;
    requestFingerprint: string;
    scheduledFor?: Date;
    actorUserId?: string;
  }): Promise<PreparedSubmission> {
    const prepared = await runInTransaction(async (transaction) => {
      const posts = new PostRepository(transaction);
      const pages = new PageRepository(transaction);
      const credentials = new PageCredentialRepository(transaction);
      const operations = new FacebookOperationRepository(transaction);
      const assets = new AssetRepository(transaction);
      const candidate = await posts.findById(input.postId);

      if (!candidate || candidate.status !== "draft") {
        throw new AppError({
          code: "DRAFT_NOT_READY",
          message: "Draft không tồn tại hoặc đã được submit.",
          status: 409,
        });
      }

      const page = await pages.findById(candidate.pageId);
      assertPageReadyForMutation(page, "Page chưa sẵn sàng để đăng bài.");

      const credential = await credentials.findForPage(
        page.id,
        input.actorUserId,
      );
      if (!credential || credential.revokedAt) {
        throw new AppError({
          code: "PAGE_CREDENTIAL_MISSING",
          message: "Page chưa có credential hợp lệ.",
          status: 409,
        });
      }
      const checkedAt = new Date();
      if (isPageCredentialExpired(credential, checkedAt)) {
        await recordExpiredPageCredential(transaction, {
          pageId: page.id,
          expiresAt: credential.expiresAt!,
          detectedAt: checkedAt,
          credentialId: credential.id,
          facebookConnectionId: credential.facebookConnectionId,
        });
        return null;
      }

      const post = await posts.claimDraftForSubmission(input.postId);
      if (!post) {
        throw new AppError({
          code: "DRAFT_NOT_READY",
          message: "Draft không tồn tại hoặc đã được submit.",
          status: 409,
        });
      }

      const media = await assets.listForPost(post.id);
      const operation = await operations.createPending({
        pageId: page.id,
        postId: post.id,
        type: input.kind,
        requestFingerprint: input.requestFingerprint,
        requestMetadata: {
          version: 1,
          messageHash: createHash("sha256").update(post.message).digest("hex"),
          postType: post.type,
          assetCount: media.length,
          scheduledFor: input.scheduledFor?.toISOString() ?? null,
        },
      });

      return {
        operationId: operation.id,
        postId: post.id,
        pageId: page.id,
        externalPageId: page.externalPageId,
        message: post.message,
        postType: post.type,
        pageCredential: toStoredPageToken(credential),
        media: media.map((asset) => ({
          assetId: asset.id,
          storageKey: asset.storageKey,
          mimeType: asset.mimeType,
        })),
      };
    });

    if (!prepared) throw pageCredentialExpiredError();
    return prepared;
  }

  async succeed(input: {
    operationId: string;
    postId: string;
    remotePostId: string;
    remoteMediaIds: string[];
    kind: SubmissionKind;
    scheduledFor?: Date;
  }): Promise<void> {
    await runInTransaction(async (transaction) => {
      const posts = new PostRepository(transaction);
      const operations = new FacebookOperationRepository(transaction);
      const assets = new AssetRepository(transaction);

      if (input.kind === "schedule") {
        if (!input.scheduledFor)
          throw new Error("scheduledFor is required for schedule success");
        await posts.markScheduled(
          input.postId,
          input.remotePostId,
          input.scheduledFor,
        );
      } else {
        await posts.markPublished(input.postId, input.remotePostId);
      }
      await assets.setRemoteMediaIds(input.postId, input.remoteMediaIds);
      await operations.markSucceeded(input.operationId, input.remotePostId);
    });
  }

  async fail(input: {
    operationId: string;
    postId: string;
    pageId: string;
    code: string;
    message: string;
    uncertain: boolean;
    credentialIncident?: PageCredentialIncidentStatus;
    credentialId?: string;
    facebookConnectionId?: string | null;
  }): Promise<void> {
    await runInTransaction(async (transaction) => {
      const posts = new PostRepository(transaction);
      const operations = new FacebookOperationRepository(transaction);

      if (input.uncertain) {
        await posts.markSubmissionUncertain(input.postId, input.code);
        await operations.markUncertain(input.operationId, input.code);
      } else {
        await posts.markSubmissionFailed(
          input.postId,
          input.code,
          input.message,
        );
        await operations.markFailed(
          input.operationId,
          input.code,
          input.message,
        );
      }
      if (input.credentialIncident) {
        await recordPageCredentialIncident(transaction, {
          pageId: input.pageId,
          status: input.credentialIncident,
          errorCode: input.code,
          operationId: input.operationId,
          credentialId: input.credentialId,
          facebookConnectionId: input.facebookConnectionId,
        });
      }
    });
  }
}

function fingerprint(input: {
  postId: string;
  kind: SubmissionKind;
  scheduledFor?: Date;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        postId: input.postId,
        kind: input.kind,
        scheduledFor: input.scheduledFor?.toISOString(),
      }),
    )
    .digest("hex");
}

export class SubmitPostService {
  constructor(
    private readonly persistence: SubmissionPersistence = new DatabaseSubmissionPersistence(),
    private readonly clientFactory: (
      credential: StoredPageToken,
    ) => SubmissionMetaClient = createMetaClientFromCredential,
    private readonly now: () => Date = () => new Date(),
    private readonly assetUrls: SubmissionAssetUrlProvider = new AssetStorage(),
  ) {}

  async publish(
    postId: string,
    actorUserId?: string,
  ): Promise<SubmissionResult> {
    return this.submit({
      postId: z.uuid().parse(postId),
      kind: "publish_now",
      actorUserId,
    });
  }

  async schedule(
    postId: string,
    scheduledForInput: unknown,
    actorUserId?: string,
  ): Promise<SubmissionResult> {
    const scheduledFor = parseFacebookScheduleTime(
      scheduledForInput,
      this.now(),
    );
    return this.submit({
      postId: z.uuid().parse(postId),
      kind: "schedule",
      scheduledFor,
      actorUserId,
    });
  }

  private async submit(input: {
    postId: string;
    kind: SubmissionKind;
    scheduledFor?: Date;
    actorUserId?: string;
  }): Promise<SubmissionResult> {
    const prepared = await this.persistence.prepare({
      postId: input.postId,
      kind: input.kind,
      requestFingerprint: fingerprint(input),
      scheduledFor: input.scheduledFor,
      actorUserId: input.actorUserId,
    });
    let remotePostId: string;
    let remoteMediaIds: string[] = [];

    try {
      const client = this.clientFactory(prepared.pageCredential);
      const mediaUrls =
        prepared.media.length > 0
          ? await this.assetUrls.createSignedUrls(
              prepared.media.map((asset) => asset.storageKey),
            )
          : [];
      if (prepared.postType === "video") {
        const fileUrl = mediaUrls[0];

        if (!fileUrl || prepared.media.length !== 1) {
          throw new AppError({
            code: "VIDEO_ASSET_INVALID",
            message: "Bài video cần đúng một tệp video hợp lệ.",
            status: 400,
          });
        }

        const videoId =
          input.kind === "schedule" && input.scheduledFor
            ? await client.scheduleVideo({
                pageId: prepared.externalPageId,
                description: prepared.message,
                fileUrl,
                scheduledFor: input.scheduledFor,
              })
            : await client.publishVideo({
                pageId: prepared.externalPageId,
                description: prepared.message,
                fileUrl,
              });

        /*
         * Video ID là identity của media object.
         * Luôn giữ nó trong post_assets.remote_media_id.
         */
        remoteMediaIds = [videoId];

        /*
         * Fallback an toàn.
         *
         * Nếu Meta chưa expose post_id hoặc lookup lỗi,
         * vẫn giữ Video ID làm remotePostId tạm thời.
         */
        remotePostId = videoId;

        try {
          const feedPostId = await client.resolveVideoPostId(videoId);

          if (feedPostId) {
            remotePostId = feedPostId;
          }
        } catch {
          /*
           * Không throw.
           *
           * Meta đã tạo video thành công.
           * Việc resolve Feed Post ID chỉ là bước normalize identity.
           */
        }
      } else {
        const receipt =
          input.kind === "schedule" && input.scheduledFor
            ? await client.schedulePost({
                pageId: prepared.externalPageId,
                message: prepared.message,
                scheduledFor: input.scheduledFor,
                mediaUrls,
              })
            : await client.publishPost({
                pageId: prepared.externalPageId,
                message: prepared.message,
                mediaUrls,
              });
        remotePostId = receipt.remotePostId;
        remoteMediaIds = receipt.remoteMediaIds;
      }
    } catch (error) {
      const normalized =
        error instanceof AppError
          ? error
          : new AppError({
              code: "FACEBOOK_SUBMISSION_ERROR",
              message: "Không thể hoàn tất thao tác với Facebook.",
              status: 502,
              cause: error,
            });
      const uncertain = normalized.retryable;

      await this.persistence.fail({
        operationId: prepared.operationId,
        postId: prepared.postId,
        pageId: prepared.pageId,
        code: normalized.code,
        message: normalized.message,
        uncertain,
        credentialIncident:
          getPageCredentialIncidentStatus(normalized) ?? undefined,
        credentialId: prepared.pageCredential.credentialId,
        facebookConnectionId: prepared.pageCredential.facebookConnectionId,
      });
      throw normalized;
    }

    try {
      await this.persistence.succeed({
        operationId: prepared.operationId,
        postId: prepared.postId,
        remotePostId,
        remoteMediaIds,
        kind: input.kind,
        scheduledFor: input.scheduledFor,
      });
    } catch (error) {
      throw new AppError({
        code: "REMOTE_SUCCESS_LOCAL_PERSIST_FAILED",
        message:
          "Facebook đã nhận bài nhưng trạng thái local chưa lưu được; cần đối soát trước khi thử lại.",
        status: 500,
        cause: error,
      });
    }

    return {
      operationId: prepared.operationId,
      postId: prepared.postId,
      remotePostId,
      status: input.kind === "schedule" ? "scheduled" : "published",
      scheduledFor: input.scheduledFor?.toISOString(),
    };
  }
}
