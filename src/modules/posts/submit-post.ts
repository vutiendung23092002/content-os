import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { runInTransaction } from "@/db/client";
import { FacebookOperationRepository } from "@/db/repositories/facebook-operation-repository";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import { PostRepository } from "@/db/repositories/post-repository";
import { decryptToken } from "@/lib/crypto/token-crypto";
import { requireServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors/app-error";
import { MetaGraphClient } from "@/modules/facebook/meta-client";

export type SubmissionKind = "publish_now" | "schedule";

export type PreparedSubmission = {
  operationId: string;
  postId: string;
  pageId: string;
  externalPageId: string;
  message: string;
  pageAccessToken: string;
};

export type SubmissionPersistence = {
  prepare(input: {
    postId: string;
    kind: SubmissionKind;
    requestFingerprint: string;
  }): Promise<PreparedSubmission>;
  succeed(input: {
    operationId: string;
    postId: string;
    remotePostId: string;
    kind: SubmissionKind;
    scheduledFor?: Date;
  }): Promise<void>;
  fail(input: {
    operationId: string;
    postId: string;
    code: string;
    message: string;
    uncertain: boolean;
  }): Promise<void>;
};

export type SubmissionMetaClient = {
  publishText(pageId: string, message: string): Promise<string>;
  scheduleText(
    pageId: string,
    message: string,
    scheduledFor: Date,
  ): Promise<string>;
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
  }): Promise<PreparedSubmission> {
    const encryptionKey = requireServerEnv("TOKEN_ENCRYPTION_KEY");

    return runInTransaction(async (transaction) => {
      const posts = new PostRepository(transaction);
      const pages = new PageRepository(transaction);
      const credentials = new PageCredentialRepository(transaction);
      const operations = new FacebookOperationRepository(transaction);
      const post = await posts.claimDraftForSubmission(input.postId);

      if (!post) {
        throw new AppError({
          code: "DRAFT_NOT_READY",
          message: "Draft không tồn tại hoặc đã được submit.",
          status: 409,
        });
      }

      const page = await pages.findById(post.pageId);
      if (!page || !page.isActive || page.connectionStatus !== "active") {
        throw new AppError({
          code: "PAGE_NOT_ACTIVE",
          message: "Page chưa sẵn sàng để đăng bài.",
          status: 409,
        });
      }

      const credential = await credentials.findByPageId(page.id);
      if (!credential || credential.revokedAt) {
        throw new AppError({
          code: "PAGE_CREDENTIAL_MISSING",
          message: "Page chưa có credential hợp lệ.",
          status: 409,
        });
      }

      const operation = await operations.createPending({
        pageId: page.id,
        postId: post.id,
        type: input.kind,
        requestFingerprint: input.requestFingerprint,
      });
      const pageAccessToken = decryptToken(
        {
          ciphertext: credential.accessTokenCiphertext,
          nonce: credential.nonce,
          authTag: credential.authTag,
          keyVersion: credential.keyVersion,
          fingerprint: credential.tokenFingerprint,
        },
        encryptionKey,
      );

      return {
        operationId: operation.id,
        postId: post.id,
        pageId: page.id,
        externalPageId: page.externalPageId,
        message: post.message,
        pageAccessToken,
      };
    });
  }

  async succeed(input: {
    operationId: string;
    postId: string;
    remotePostId: string;
    kind: SubmissionKind;
    scheduledFor?: Date;
  }): Promise<void> {
    await runInTransaction(async (transaction) => {
      const posts = new PostRepository(transaction);
      const operations = new FacebookOperationRepository(transaction);

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
      await operations.markSucceeded(input.operationId, input.remotePostId);
    });
  }

  async fail(input: {
    operationId: string;
    postId: string;
    code: string;
    message: string;
    uncertain: boolean;
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
      pageAccessToken: string,
    ) => SubmissionMetaClient = (pageAccessToken) =>
      new MetaGraphClient({
        graphVersion: requireServerEnv("FACEBOOK_GRAPH_API_VERSION"),
        accessToken: pageAccessToken,
      }),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(postId: string): Promise<SubmissionResult> {
    return this.submit({ postId: z.uuid().parse(postId), kind: "publish_now" });
  }

  async schedule(
    postId: string,
    scheduledForInput: unknown,
  ): Promise<SubmissionResult> {
    const scheduledFor = new Date(z.iso.datetime().parse(scheduledForInput));
    if (scheduledFor.getTime() <= this.now().getTime()) {
      throw new AppError({
        code: "SCHEDULE_TIME_INVALID",
        message: "Thời gian hẹn đăng phải ở tương lai.",
        status: 400,
      });
    }
    return this.submit({
      postId: z.uuid().parse(postId),
      kind: "schedule",
      scheduledFor,
    });
  }

  private async submit(input: {
    postId: string;
    kind: SubmissionKind;
    scheduledFor?: Date;
  }): Promise<SubmissionResult> {
    const prepared = await this.persistence.prepare({
      postId: input.postId,
      kind: input.kind,
      requestFingerprint: fingerprint(input),
    });
    const client = this.clientFactory(prepared.pageAccessToken);

    let remotePostId: string;

    try {
      remotePostId =
        input.kind === "schedule" && input.scheduledFor
          ? await client.scheduleText(
              prepared.externalPageId,
              prepared.message,
              input.scheduledFor,
            )
          : await client.publishText(prepared.externalPageId, prepared.message);
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
        code: normalized.code,
        message: normalized.message,
        uncertain,
      });
      throw normalized;
    }

    try {
      await this.persistence.succeed({
        operationId: prepared.operationId,
        postId: prepared.postId,
        remotePostId,
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
