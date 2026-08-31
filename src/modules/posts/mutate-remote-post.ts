import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "@/db/client";
import { AssetRepository } from "@/db/repositories/asset-repository";
import { FacebookOperationRepository } from "@/db/repositories/facebook-operation-repository";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import { PostRepository } from "@/db/repositories/post-repository";
import { AppError } from "@/lib/errors/app-error";
import {
  createMetaClientFromCredential,
  toStoredPageToken,
  type StoredPageToken,
} from "@/modules/facebook/page-credential";

type MutationKind = "update" | "remove";

type PreparedMutation = {
  operationId: string;
  postId: string;
  pageId: string;
  remotePostId: string;
  remoteMediaIds: string[];
  postType: "text" | "image" | "video";
  status: "scheduled" | "published";
  pageCredential: StoredPageToken;
};

type CompletedRemoval = PreparedMutation & {
  deletedRemotePostId: string;
};

export function collectRemoteMediaIdsForMutation(
  assetRemoteMediaIds: Array<string | null>,
  remoteSnapshot: unknown,
): string[] {
  const snapshotIds: unknown[] =
    remoteSnapshot &&
    typeof remoteSnapshot === "object" &&
    !Array.isArray(remoteSnapshot) &&
    Array.isArray((remoteSnapshot as Record<string, unknown>).remoteMediaIds)
      ? ((remoteSnapshot as Record<string, unknown>)
          .remoteMediaIds as unknown[])
      : [];

  return [
    ...new Set(
      [...assetRemoteMediaIds, ...snapshotIds]
        .filter(
          (remoteMediaId): remoteMediaId is string =>
            typeof remoteMediaId === "string" &&
            remoteMediaId.trim().length > 0,
        )
        .map((remoteMediaId) => remoteMediaId.trim()),
    ),
  ];
}

function collectVideoRemoteMediaIds(
  prepared: PreparedMutation,
  deletedRemotePostId: string,
): string[] {
  if (prepared.postType !== "video") {
    return prepared.remoteMediaIds;
  }

  const derivedAliases = [prepared.remotePostId, deletedRemotePostId].flatMap(
    (remotePostId) => {
      const separatorIndex = remotePostId.lastIndexOf("_");
      const suffix = remotePostId.slice(separatorIndex + 1).trim();

      return separatorIndex >= 0 && suffix.length > 0 ? [suffix] : [];
    },
  );

  return [...new Set([...prepared.remoteMediaIds, ...derivedAliases])];
}

export type RemotePostMutationClient = {
  updatePostMessage(remotePostId: string, message: string): Promise<void>;

  deletePost(remotePostId: string): Promise<void>;

  resolveVideoPostId(videoId: string): Promise<string | null>;
};

export type RemotePostMutationPersistence = {
  prepare(input: {
    postId: string;
    kind: MutationKind;
    message?: string;
    requestFingerprint: string;
  }): Promise<PreparedMutation>;

  updateSucceeded(
    input: PreparedMutation & {
      message: string;
    },
  ): Promise<void>;

  removeSucceeded(input: CompletedRemoval): Promise<void>;

  fail(operationId: string, code: string, message: string): Promise<void>;

  uncertain(operationId: string, code: string): Promise<void>;
};

class DatabaseRemotePostMutationPersistence implements RemotePostMutationPersistence {
  async prepare(input: {
    postId: string;
    kind: MutationKind;
    message?: string;
    requestFingerprint: string;
  }): Promise<PreparedMutation> {
    return runInTransaction(async (transaction) => {
      const post = await new PostRepository(transaction).findById(input.postId);

      if (
        !post ||
        (post.status !== "scheduled" && post.status !== "published") ||
        !post.remotePostId
      ) {
        throw new AppError({
          code: "REMOTE_POST_NOT_MUTABLE",
          message:
            "Bài viết không còn ở trạng thái có thể thao tác trên Facebook.",
          status: post ? 409 : 404,
        });
      }

      /*
       * Với video:
       *
       * posts.remotePostId
       *   = Page / Feed Post ID
       *
       * post_assets.remoteMediaId
       *   = Video Object ID
       *
       * Ta cần giữ cả hai để khi delete/cancel
       * có thể tombstone tất cả local aliases.
       */
      const assets = await new AssetRepository(transaction).listForPost(
        post.id,
      );

      const remoteMediaIds = collectRemoteMediaIdsForMutation(
        assets.map((asset) => asset.remoteMediaId),
        post.remoteSnapshot,
      );

      const page = await new PageRepository(transaction).findById(post.pageId);

      if (!page || !page.isActive || page.connectionStatus !== "active") {
        throw new AppError({
          code: "PAGE_NOT_ACTIVE",
          message: "Page chưa sẵn sàng để cập nhật bài viết.",
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
        type: input.kind === "update" ? "update" : "cancel",
        requestFingerprint: input.requestFingerprint,
        requestMetadata: {
          version: 1,
          remotePostId: post.remotePostId,
          previousStatus: post.status,
          ...(input.message === undefined
            ? {}
            : {
                message: input.message,
              }),
        },
      });

      return {
        operationId: operation.id,
        postId: post.id,
        pageId: page.id,
        remotePostId: post.remotePostId,

        /*
         * NEW:
         * giữ Video ID / media aliases
         * cho bước removeSucceeded().
         */
        remoteMediaIds,

        postType: post.type,
        status: post.status,

        pageCredential: toStoredPageToken(credential),
      };
    });
  }

  async updateSucceeded(
    input: PreparedMutation & {
      message: string;
    },
  ) {
    await runInTransaction(async (transaction) => {
      const updated = await new PostRepository(transaction).updateRemoteMessage(
        input.postId,
        input.remotePostId,
        input.message,
      );

      if (!updated) {
        throw new Error("Remote post changed before persistence");
      }

      await new FacebookOperationRepository(transaction).markSucceeded(
        input.operationId,
        input.remotePostId,
      );
    });
  }

  async removeSucceeded(input: CompletedRemoval) {
    await runInTransaction(async (transaction) => {
      const updated = await new PostRepository(transaction).markRemoteRemoved(
        input.postId,
        input.pageId,
        input.remotePostId,
        input.status,

        /*
         * Tombstone tất cả identity
         * mà ta biết:
         *
         * - deletedRemotePostId:
         *     Feed Post ID thực tế vừa DELETE
         *
         * - remoteMediaIds:
         *     Video Object ID / media aliases
         *
         * Nhờ vậy không còn row video cũ
         * sống sót thành ghost post.
         */
        [input.deletedRemotePostId, ...input.remoteMediaIds],
      );

      if (!updated) {
        throw new Error("Remote post changed before persistence");
      }

      await new FacebookOperationRepository(transaction).markSucceeded(
        input.operationId,
        input.deletedRemotePostId,
      );
    });
  }

  async fail(operationId: string, code: string, message: string) {
    await new FacebookOperationRepository(getDatabase()).markFailed(
      operationId,
      code,
      message,
    );
  }

  async uncertain(operationId: string, code: string) {
    await new FacebookOperationRepository(getDatabase()).markUncertain(
      operationId,
      code,
    );
  }
}

function fingerprint(input: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export class RemotePostMutationService {
  constructor(
    private readonly persistence: RemotePostMutationPersistence = new DatabaseRemotePostMutationPersistence(),

    private readonly clientFactory: (
      credential: StoredPageToken,
    ) => RemotePostMutationClient = createMetaClientFromCredential,
  ) {}

  async updateMessage(postIdInput: unknown, messageInput: unknown) {
    const postId = z.uuid().parse(postIdInput);

    const message = z.string().trim().max(63_206).parse(messageInput);

    const prepared = await this.persistence.prepare({
      postId,
      kind: "update",
      message,
      requestFingerprint: fingerprint({
        postId,
        kind: "update",
        message,
      }),
    });

    await this.runRemoteMutation(prepared.operationId, () =>
      this.clientFactory(prepared.pageCredential).updatePostMessage(
        prepared.remotePostId,
        message,
      ),
    );

    await this.persistRemoteSuccess(prepared.operationId, () =>
      this.persistence.updateSucceeded({
        ...prepared,
        message,
      }),
    );

    return {
      operationId: prepared.operationId,
      postId,
      remotePostId: prepared.remotePostId,
      status: "succeeded" as const,
    };
  }

  async remove(postIdInput: unknown) {
    const postId = z.uuid().parse(postIdInput);

    const prepared = await this.persistence.prepare({
      postId,
      kind: "remove",
      requestFingerprint: fingerprint({
        postId,
        kind: "remove",
      }),
    });

    const client = this.clientFactory(prepared.pageCredential);

    /*
     * Legacy video:
     *
     * Một số row cũ lưu Video Object ID trực tiếp
     * trong posts.remotePostId.
     *
     * Nếu ID không có "_" thì thử resolve
     * sang Page / Feed Post ID trước khi DELETE.
     */
    const deletedRemotePostId =
      prepared.postType === "video" && !prepared.remotePostId.includes("_")
        ? ((await this.runRemoteLookup(prepared.operationId, () =>
            client.resolveVideoPostId(prepared.remotePostId),
          )) ?? prepared.remotePostId)
        : prepared.remotePostId;

    await this.runRemoteMutation(prepared.operationId, () =>
      client.deletePost(deletedRemotePostId),
    );

    const completed = {
      ...prepared,
      deletedRemotePostId,
      remoteMediaIds: collectVideoRemoteMediaIds(prepared, deletedRemotePostId),
    };

    await this.persistRemoteSuccess(prepared.operationId, () =>
      this.persistence.removeSucceeded(completed),
    );

    return {
      operationId: prepared.operationId,
      postId,
      remotePostId: prepared.remotePostId,
      previousStatus: prepared.status,
      status: "succeeded" as const,
    };
  }

  private async runRemoteLookup<T>(
    operationId: string,
    lookup: () => Promise<T>,
  ): Promise<T> {
    try {
      return await lookup();
    } catch (error) {
      await this.recordRemoteFailure(operationId, error);

      throw error;
    }
  }

  private async runRemoteMutation(
    operationId: string,
    mutate: () => Promise<void>,
  ) {
    try {
      await mutate();
    } catch (error) {
      await this.recordRemoteFailure(operationId, error);

      throw error;
    }
  }

  private async persistRemoteSuccess(
    operationId: string,
    persist: () => Promise<void>,
  ) {
    try {
      await persist();
    } catch (error) {
      await this.persistence.uncertain(
        operationId,
        "REMOTE_SUCCESS_LOCAL_PERSIST_FAILED",
      );

      throw new AppError({
        code: "REMOTE_SUCCESS_LOCAL_PERSIST_FAILED",
        message:
          "Facebook đã xác nhận thao tác nhưng HanContent chưa ghi nhận được kết quả. Hãy làm mới và đối soát trước khi thao tác lại.",
        status: 500,
        cause: error,
      });
    }
  }

  private async recordRemoteFailure(operationId: string, error: unknown) {
    const normalized =
      error instanceof AppError
        ? error
        : new AppError({
            code: "FACEBOOK_REMOTE_MUTATION_FAILED",
            message: "Không thể hoàn tất thao tác trên Facebook.",
            status: 502,
            cause: error,
          });

    if (normalized.retryable) {
      await this.persistence.uncertain(operationId, normalized.code);
    } else {
      await this.persistence.fail(
        operationId,
        normalized.code,
        normalized.message,
      );
    }
  }
}
