import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "@/db/client";
import { FacebookOperationRepository } from "@/db/repositories/facebook-operation-repository";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import { PostRepository } from "@/db/repositories/post-repository";
import { decryptToken } from "@/lib/crypto/token-crypto";
import { requireServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors/app-error";
import { MetaGraphClient } from "@/modules/facebook/meta-client";
import { parseFacebookScheduleTime } from "./schedule-window";

const MAX_REMOTE_PAGES = 5;
const REMOTE_TIME_TOLERANCE_MS = 60_000;

type ScheduledRemotePost = {
  id: string;
  scheduled_publish_time?: string | number;
};

export type RescheduleMetaClient = {
  getScheduledPosts(
    pageId: string,
    after?: string,
    limit?: number,
  ): Promise<{ posts: ScheduledRemotePost[]; after?: string }>;
  reschedulePost(remotePostId: string, scheduledFor: Date): Promise<void>;
};

export type PreparedReschedule = {
  operationId: string;
  postId: string;
  pageId: string;
  externalPageId: string;
  remotePostId: string;
  previousScheduledFor: Date;
  pageAccessToken: string;
};

export type ReschedulePersistence = {
  prepare(input: {
    postId: string;
    scheduledFor: Date;
    requestFingerprint: string;
  }): Promise<PreparedReschedule>;
  succeed(input: {
    operationId: string;
    postId: string;
    remotePostId: string;
    scheduledFor: Date;
  }): Promise<void>;
  fail(input: {
    operationId: string;
    code: string;
    message: string;
  }): Promise<void>;
  uncertain(input: {
    operationId: string;
    code: string;
    evidence: Record<string, unknown>;
  }): Promise<void>;
};

class DatabaseReschedulePersistence implements ReschedulePersistence {
  async prepare(input: {
    postId: string;
    scheduledFor: Date;
    requestFingerprint: string;
  }): Promise<PreparedReschedule> {
    return runInTransaction(async (transaction) => {
      const posts = new PostRepository(transaction);
      const post = await posts.findById(input.postId);
      if (!post) {
        throw new AppError({
          code: "POST_NOT_FOUND",
          message: "Không tìm thấy bài viết.",
          status: 404,
        });
      }
      if (post.status === "published") {
        throw new AppError({
          code: "POST_ALREADY_PUBLISHED",
          message: "Bài viết đã đăng nên không thể đổi lịch.",
          status: 409,
        });
      }
      if (
        post.status !== "scheduled" ||
        !post.remotePostId ||
        !post.scheduledAt
      ) {
        throw new AppError({
          code: "POST_NOT_SCHEDULED",
          message: "Chỉ có thể đổi lịch bài đang được Facebook hẹn giờ.",
          status: 409,
        });
      }

      const page = await new PageRepository(transaction).findById(post.pageId);
      if (!page || !page.isActive || page.connectionStatus !== "active") {
        throw new AppError({
          code: "PAGE_NOT_ACTIVE",
          message: "Page chưa sẵn sàng để đổi lịch bài viết.",
          status: 409,
        });
      }
      const credential = await new PageCredentialRepository(
        transaction,
      ).findByPageId(page.id);
      if (
        !credential ||
        credential.revokedAt ||
        (credential.expiresAt && credential.expiresAt <= new Date())
      ) {
        throw new AppError({
          code: "PAGE_CREDENTIAL_MISSING",
          message: "Page chưa có credential hợp lệ.",
          status: 409,
        });
      }

      const operation = await new FacebookOperationRepository(
        transaction,
      ).createPending({
        pageId: page.id,
        postId: post.id,
        type: "reschedule",
        requestFingerprint: input.requestFingerprint,
        requestMetadata: {
          version: 1,
          remotePostId: post.remotePostId,
          previousScheduledFor: post.scheduledAt.toISOString(),
          scheduledFor: input.scheduledFor.toISOString(),
        },
      });

      return {
        operationId: operation.id,
        postId: post.id,
        pageId: page.id,
        externalPageId: page.externalPageId,
        remotePostId: post.remotePostId,
        previousScheduledFor: post.scheduledAt,
        pageAccessToken: decryptToken(
          {
            ciphertext: credential.accessTokenCiphertext,
            nonce: credential.nonce,
            authTag: credential.authTag,
            keyVersion: credential.keyVersion,
            fingerprint: credential.tokenFingerprint,
          },
          requireServerEnv("TOKEN_ENCRYPTION_KEY"),
        ),
      };
    });
  }

  async succeed(input: {
    operationId: string;
    postId: string;
    remotePostId: string;
    scheduledFor: Date;
  }) {
    await runInTransaction(async (transaction) => {
      const updated = await new PostRepository(transaction).updateScheduledTime(
        input.postId,
        input.remotePostId,
        input.scheduledFor,
      );
      if (!updated)
        throw new Error("Scheduled post changed before persistence");
      await new FacebookOperationRepository(transaction).markSucceeded(
        input.operationId,
        input.remotePostId,
      );
    });
  }

  async fail(input: { operationId: string; code: string; message: string }) {
    await new FacebookOperationRepository(getDatabase()).markFailed(
      input.operationId,
      input.code,
      input.message,
    );
  }

  async uncertain(input: {
    operationId: string;
    code: string;
    evidence: Record<string, unknown>;
  }) {
    void input.evidence;
    await new FacebookOperationRepository(getDatabase()).markUncertain(
      input.operationId,
      input.code,
    );
  }
}

function fingerprint(postId: string, scheduledFor: Date): string {
  return createHash("sha256")
    .update(
      JSON.stringify({ postId, scheduledFor: scheduledFor.toISOString() }),
    )
    .digest("hex");
}

function remoteTime(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric * 1000)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export class ReschedulePostService {
  constructor(
    private readonly persistence: ReschedulePersistence = new DatabaseReschedulePersistence(),
    private readonly clientFactory: (token: string) => RescheduleMetaClient = (
      token,
    ) =>
      new MetaGraphClient({
        graphVersion: requireServerEnv("FACEBOOK_GRAPH_API_VERSION"),
        accessToken: token,
      }),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reschedule(postIdInput: unknown, scheduledForInput: unknown) {
    const postId = z.uuid().parse(postIdInput);
    const scheduledFor = parseFacebookScheduleTime(
      scheduledForInput,
      this.now(),
    );
    const prepared = await this.persistence.prepare({
      postId,
      scheduledFor,
      requestFingerprint: fingerprint(postId, scheduledFor),
    });
    const client = this.clientFactory(prepared.pageAccessToken);

    let before: ScheduledRemotePost | undefined;
    try {
      before = await this.findRemote(client, prepared);
    } catch (error) {
      const normalized =
        error instanceof AppError
          ? error
          : new AppError({
              code: "FACEBOOK_SCHEDULE_READ_FAILED",
              message: "Không thể kiểm tra bài hẹn giờ trên Facebook.",
              status: 502,
              cause: error,
            });
      await this.persistence.fail({
        operationId: prepared.operationId,
        code: normalized.code,
        message: normalized.message,
      });
      throw normalized;
    }
    if (!before) {
      await this.persistence.fail({
        operationId: prepared.operationId,
        code: "REMOTE_SCHEDULE_NOT_FOUND",
        message: "Không tìm thấy bài đang hẹn giờ trên Facebook.",
      });
      throw new AppError({
        code: "REMOTE_SCHEDULE_NOT_FOUND",
        message: "Không tìm thấy bài đang hẹn giờ trên Facebook.",
        status: 409,
      });
    }

    try {
      await client.reschedulePost(prepared.remotePostId, scheduledFor);
    } catch (error) {
      const normalized =
        error instanceof AppError
          ? error
          : new AppError({
              code: "FACEBOOK_RESCHEDULE_ERROR",
              message: "Không thể đổi lịch bài viết trên Facebook.",
              status: 502,
              cause: error,
            });
      if (!normalized.retryable) {
        await this.persistence.fail({
          operationId: prepared.operationId,
          code: normalized.code,
          message: normalized.message,
        });
        throw normalized;
      }

      const confirmed = await this.readDesiredTime(
        client,
        prepared,
        scheduledFor,
      ).catch(() => false);
      if (confirmed) return this.persistSuccess(prepared, scheduledFor);
      await this.markUncertain(prepared, scheduledFor, normalized.code);
      throw new AppError({
        code: "FACEBOOK_RESCHEDULE_UNCERTAIN",
        message:
          "Chưa xác định được Facebook đã đổi lịch hay chưa; hệ thống sẽ đối soát và không tự gửi lại thao tác.",
        status: 502,
        retryable: false,
        cause: normalized,
      });
    }

    let confirmed = false;
    try {
      confirmed = await this.readDesiredTime(client, prepared, scheduledFor);
    } catch (error) {
      await this.markUncertain(
        prepared,
        scheduledFor,
        error instanceof AppError
          ? error.code
          : "FACEBOOK_RESCHEDULE_READBACK_FAILED",
      );
      throw new AppError({
        code: "FACEBOOK_RESCHEDULE_UNCERTAIN",
        message:
          "Facebook đã nhận yêu cầu nhưng chưa thể đọc lại lịch mới; hệ thống sẽ đối soát và không tự gửi lại thao tác.",
        status: 502,
        retryable: false,
        cause: error,
      });
    }
    if (!confirmed) {
      await this.markUncertain(
        prepared,
        scheduledFor,
        "REMOTE_READBACK_MISMATCH",
      );
      throw new AppError({
        code: "REMOTE_READBACK_MISMATCH",
        message:
          "Facebook chưa trả về đúng lịch mới; cần đối soát trước khi thao tác tiếp.",
        status: 409,
      });
    }
    return this.persistSuccess(prepared, scheduledFor);
  }

  private async findRemote(
    client: RescheduleMetaClient,
    prepared: PreparedReschedule,
  ): Promise<ScheduledRemotePost | undefined> {
    let after: string | undefined;
    for (let page = 0; page < MAX_REMOTE_PAGES; page += 1) {
      const result = await client.getScheduledPosts(
        prepared.externalPageId,
        after,
        100,
      );
      const match = result.posts.find(
        (post) => post.id === prepared.remotePostId,
      );
      if (match) return match;
      if (!result.after) return undefined;
      after = result.after;
    }
    throw new AppError({
      code: "REMOTE_SCHEDULE_SCAN_INCOMPLETE",
      message: "Chưa quét hết lịch Facebook; không thực hiện đổi lịch.",
      status: 409,
    });
  }

  private async readDesiredTime(
    client: RescheduleMetaClient,
    prepared: PreparedReschedule,
    scheduledFor: Date,
  ): Promise<boolean> {
    const post = await this.findRemote(client, prepared);
    const actual = remoteTime(post?.scheduled_publish_time);
    return (
      actual !== null &&
      Math.abs(actual - scheduledFor.getTime()) <= REMOTE_TIME_TOLERANCE_MS
    );
  }

  private async markUncertain(
    prepared: PreparedReschedule,
    scheduledFor: Date,
    code: string,
  ) {
    await this.persistence.uncertain({
      operationId: prepared.operationId,
      code,
      evidence: {
        version: 1,
        reason: "reschedule_readback_unconfirmed",
        checkedAt: this.now().toISOString(),
        remotePostId: prepared.remotePostId,
        previousScheduledFor: prepared.previousScheduledFor.toISOString(),
        scheduledFor: scheduledFor.toISOString(),
      },
    });
  }

  private async persistSuccess(
    prepared: PreparedReschedule,
    scheduledFor: Date,
  ) {
    try {
      await this.persistence.succeed({
        operationId: prepared.operationId,
        postId: prepared.postId,
        remotePostId: prepared.remotePostId,
        scheduledFor,
      });
    } catch (error) {
      throw new AppError({
        code: "REMOTE_SUCCESS_LOCAL_PERSIST_FAILED",
        message:
          "Facebook đã đổi lịch nhưng trạng thái local chưa lưu được; cần đối soát trước khi thử lại.",
        status: 500,
        cause: error,
      });
    }
    return {
      operationId: prepared.operationId,
      postId: prepared.postId,
      remotePostId: prepared.remotePostId,
      status: "scheduled" as const,
      scheduledFor: scheduledFor.toISOString(),
    };
  }
}
