import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "@/db/client";
import {
  FacebookOperationRepository,
  type FacebookOperationRecord,
} from "@/db/repositories/facebook-operation-repository";
import { AssetRepository } from "@/db/repositories/asset-repository";
import {
  PostRepository,
  type PostRecord,
} from "@/db/repositories/post-repository";
import { AppError } from "@/lib/errors/app-error";
import {
  RemotePostReader,
  type RemotePostCredentialProvenance,
  type RemoteFacebookPost,
  type RemotePostKind,
} from "./remote-post-reader";

const STALE_PENDING_MS = 2 * 60 * 1000;
const PUBLISHED_WINDOW_BEFORE_MS = 2 * 60 * 1000;
const PUBLISHED_WINDOW_AFTER_MS = 10 * 60 * 1000;
const MAX_REMOTE_PAGES = 5;
const REMOTE_VISIBILITY_GRACE_MS = 10 * 60 * 1000;
const CREDENTIAL_UNAVAILABLE_CODES = new Set([
  "PAGE_CREDENTIAL_MISSING",
  "PAGE_CREDENTIAL_EXPIRED",
  "PAGE_NOT_ACTIVE",
  "FACEBOOK_TOKEN_INVALID",
  "FACEBOOK_PERMISSION_DENIED",
  "TOKEN_DECRYPTION_FAILED",
  "UNKNOWN_TOKEN_KEY_VERSION",
]);

const requestMetadataSchema = z.object({
  version: z.literal(1).optional(),
  messageHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  postType: z.enum(["text", "image", "video"]).optional(),
  assetCount: z.number().int().nonnegative().max(10).optional(),
  scheduledFor: z.iso.datetime().nullable().optional(),
  remotePostId: z.string().trim().min(1).max(256).optional(),
  previousScheduledFor: z.iso.datetime().optional(),
});

export const manualResolutionSchema = z.discriminatedUnion("resolution", [
  z
    .object({
      resolution: z.literal("remote_created"),
      remotePostId: z.string().trim().min(1).max(256),
      note: z.string().trim().min(10).max(500),
    })
    .strict(),
  z
    .object({
      resolution: z.literal("remote_not_created"),
      note: z.string().trim().min(10).max(500),
    })
    .strict(),
]);

type ReviewRecord = {
  operation: FacebookOperationRecord;
  post: PostRecord;
  assetCount: number;
};

type ReconciliationPersistence = {
  load(operationId: string): Promise<ReviewRecord | undefined>;
  list(input: {
    stalePendingBefore: Date;
    limit?: number;
  }): Promise<ReviewRecord[]>;
  needsAttention(input: {
    operationId: string;
    postId: string;
    message: string;
    evidence: Record<string, unknown>;
  }): Promise<void>;
  succeed(input: {
    operationId: string;
    postId: string;
    kind: "publish_now" | "schedule";
    remotePostId: string;
    effectiveAt: Date;
    evidence: Record<string, unknown>;
    resolvedByUserId?: string;
  }): Promise<void>;
  fail(input: {
    operationId: string;
    postId: string;
    evidence: Record<string, unknown>;
    resolvedByUserId: string;
  }): Promise<void>;
  rescheduleSucceeded(input: {
    operationId: string;
    postId: string;
    remotePostId: string;
    scheduledFor: Date;
    evidence: Record<string, unknown>;
  }): Promise<void>;
  rescheduleNeedsAttention(input: {
    operationId: string;
    evidence: Record<string, unknown>;
  }): Promise<void>;
};

type ReconciliationReader = Pick<RemotePostReader, "list">;

type ReconciliationCredentialAccess =
  | { kind: "admin_managed" }
  | { kind: "exact"; provenance: RemotePostCredentialProvenance }
  | {
      kind: "needs_attention";
      reason:
        "actor_reconciliation_required" | "credential_provenance_unavailable";
    };

export type ReconciliationResult = {
  operationId: string;
  postId: string;
  status: "succeeded" | "failed" | "needs_attention";
  resolution:
    "remote_created" | "remote_updated" | "remote_not_created" | "unresolved";
  remotePostId?: string;
  reason: string;
};

class DatabaseReconciliationPersistence implements ReconciliationPersistence {
  async load(operationId: string): Promise<ReviewRecord | undefined> {
    const database = getDatabase();
    const operation = await new FacebookOperationRepository(database).findById(
      operationId,
    );
    if (!operation?.postId) return undefined;
    const [post, assets] = await Promise.all([
      new PostRepository(database).findById(operation.postId),
      new AssetRepository(database).listForPost(operation.postId),
    ]);
    return post ? { operation, post, assetCount: assets.length } : undefined;
  }

  async list(input: { stalePendingBefore: Date; limit?: number }) {
    const operations = await new FacebookOperationRepository(
      getDatabase(),
    ).listReviewable(input);
    const records = await Promise.all(
      operations.map((operation) => this.load(operation.id)),
    );
    return records.filter((record): record is ReviewRecord => Boolean(record));
  }

  async needsAttention(input: {
    operationId: string;
    postId: string;
    message: string;
    evidence: Record<string, unknown>;
  }) {
    await runInTransaction(async (transaction) => {
      await new PostRepository(transaction).markNeedsAttention(
        input.postId,
        input.message,
      );
      await new FacebookOperationRepository(transaction).markNeedsAttention(
        input.operationId,
        input.evidence,
      );
    });
  }

  async succeed(input: {
    operationId: string;
    postId: string;
    kind: "publish_now" | "schedule";
    remotePostId: string;
    effectiveAt: Date;
    evidence: Record<string, unknown>;
    resolvedByUserId?: string;
  }) {
    await runInTransaction(async (transaction) => {
      const posts = new PostRepository(transaction);
      if (input.kind === "schedule") {
        await posts.markScheduled(
          input.postId,
          input.remotePostId,
          input.effectiveAt,
        );
      } else {
        await posts.markReconciledPublished(
          input.postId,
          input.remotePostId,
          input.effectiveAt,
        );
      }
      await new FacebookOperationRepository(
        transaction,
      ).markReconciledSucceeded({
        id: input.operationId,
        remotePostId: input.remotePostId,
        evidence: input.evidence,
        resolvedByUserId: input.resolvedByUserId,
      });
    });
  }

  async fail(input: {
    operationId: string;
    postId: string;
    evidence: Record<string, unknown>;
    resolvedByUserId: string;
  }) {
    await runInTransaction(async (transaction) => {
      await new PostRepository(transaction).markSubmissionFailed(
        input.postId,
        "REMOTE_NOT_CREATED",
        "Admin đã xác nhận không có bài remote; hệ thống không tự động retry.",
      );
      await new FacebookOperationRepository(transaction).markReconciledFailed({
        id: input.operationId,
        evidence: input.evidence,
        resolvedByUserId: input.resolvedByUserId,
      });
    });
  }

  async rescheduleSucceeded(input: {
    operationId: string;
    postId: string;
    remotePostId: string;
    scheduledFor: Date;
    evidence: Record<string, unknown>;
  }) {
    await runInTransaction(async (transaction) => {
      const updated = await new PostRepository(transaction).updateScheduledTime(
        input.postId,
        input.remotePostId,
        input.scheduledFor,
      );
      if (!updated)
        throw new Error("Scheduled post changed before reconciliation");
      await new FacebookOperationRepository(
        transaction,
      ).markReconciledMutationSucceeded({
        id: input.operationId,
        remotePostId: input.remotePostId,
        evidence: input.evidence,
      });
    });
  }

  async rescheduleNeedsAttention(input: {
    operationId: string;
    evidence: Record<string, unknown>;
  }) {
    await new FacebookOperationRepository(getDatabase()).markNeedsAttention(
      input.operationId,
      input.evidence,
    );
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function remoteAssetCount(post: RemoteFacebookPost): number {
  if (post.mediaType === "text") return 0;
  if (post.mediaType === "video") return 1;
  return Math.max(post.imageUrls.length, post.imageUrl ? 1 : 0);
}

function safeCandidate(post: RemoteFacebookPost) {
  return {
    remotePostId: post.remoteId,
    kind: post.kind,
    messageHash: sha256(post.message),
    mediaType: post.mediaType,
    assetCount: remoteAssetCount(post),
    effectiveAt: post.effectiveAt,
    createdAt: post.createdAt,
  };
}

function evidenceCandidates(evidence: Record<string, unknown>): string[] {
  const parsed = z
    .object({
      candidates: z
        .array(z.object({ remotePostId: z.string().min(1) }))
        .optional(),
    })
    .safeParse(evidence);
  return parsed.success
    ? (parsed.data.candidates?.map((item) => item.remotePostId) ?? [])
    : [];
}

export class ReconcileFacebookOperationService {
  constructor(
    private readonly persistence: ReconciliationPersistence = new DatabaseReconciliationPersistence(),
    private readonly reader: ReconciliationReader = new RemotePostReader(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(limit = 50) {
    const records = await this.persistence.list({
      stalePendingBefore: new Date(this.now().getTime() - STALE_PENDING_MS),
      limit,
    });
    return records.map(({ operation, post }) => ({
      operationId: operation.id,
      postId: post.id,
      pageId: operation.pageId,
      type: operation.type,
      status: operation.status,
      startedAt: operation.startedAt.toISOString(),
      resolution: operation.resolution,
      evidence: operation.resolutionEvidence,
    }));
  }

  async reconcile(
    operationIdInput: unknown,
    actorUserIdInput?: string,
  ): Promise<ReconciliationResult> {
    const operationId = z.uuid().parse(operationIdInput);
    const actorUserId = actorUserIdInput
      ? z.uuid().parse(actorUserIdInput)
      : undefined;
    const record = await this.requireReviewable(operationId);
    const metadata = this.metadataFor(record);
    const credentialAccess = this.credentialAccessFor(record, actorUserId);
    if (credentialAccess.kind === "needs_attention") {
      return this.storeAttention(
        record,
        credentialAccess.reason,
        [],
        credentialAccess.reason === "actor_reconciliation_required"
          ? "This user-connected operation requires authorized Admin reconciliation with its stored provenance."
          : "The credential stored on this operation is unavailable; no other credential was substituted.",
      );
    }

    if (record.operation.type === "reschedule") {
      return this.reconcileReschedule(record, metadata, credentialAccess);
    }

    if (record.operation.type === "schedule" && !metadata.scheduledFor) {
      return this.storeAttention(
        record,
        "missing_schedule_evidence",
        [],
        "Thiếu thời gian hẹn gốc; Admin cần đối soát thủ công.",
      );
    }

    const scan = await this.findCandidates(record, metadata, credentialAccess);
    if (scan.credentialUnavailable) {
      return this.storeAttention(
        record,
        "credential_provenance_unavailable",
        [],
        "The credential stored on this operation is unavailable; no other credential was substituted.",
      );
    }
    const { candidates } = scan;
    if (!scan.complete || candidates.length !== 1) {
      const visibilityWindowOpen =
        candidates.length === 0 &&
        this.now().getTime() <
          record.operation.startedAt.getTime() + REMOTE_VISIBILITY_GRACE_MS;
      const reason = !scan.complete
        ? "scan_incomplete"
        : candidates.length > 1
          ? "ambiguous_match"
          : visibilityWindowOpen
            ? "visibility_window_open"
            : "no_match";
      return this.storeAttention(
        record,
        reason,
        candidates,
        reason === "ambiguous_match"
          ? "Tìm thấy nhiều bài có cùng bằng chứng; Admin cần chọn đúng bài."
          : reason === "scan_incomplete"
            ? "Chưa quét hết dữ liệu Facebook; không được kết luận bài chưa được tạo."
            : reason === "visibility_window_open"
              ? "Facebook có thể chưa đồng bộ xong; cần chờ rồi đối soát lại."
              : "Chưa tìm thấy bài remote; không tự động retry.",
      );
    }

    const candidate = candidates[0]!;
    const effectiveAt = this.effectiveDate(candidate, metadata);
    const evidence = this.buildEvidence(record, "unique_match", candidates);
    await this.persistSuccess({
      operationId,
      postId: record.post.id,
      kind: record.operation.type,
      remotePostId: candidate.remoteId,
      effectiveAt,
      evidence,
    });
    return {
      operationId,
      postId: record.post.id,
      status: "succeeded",
      resolution: "remote_created",
      remotePostId: candidate.remoteId,
      reason: "unique_match",
    };
  }

  async resolveManually(input: {
    operationId: unknown;
    actorUserId: string;
    resolution: unknown;
  }): Promise<ReconciliationResult> {
    const operationId = z.uuid().parse(input.operationId);
    const actorUserId = z.uuid().parse(input.actorUserId);
    const resolution = manualResolutionSchema.parse(input.resolution);
    const record = await this.requireReviewable(operationId, true);
    const credentialAccess = this.credentialAccessFor(record, actorUserId);
    if (credentialAccess.kind === "needs_attention") {
      throw new AppError({
        code: "RECONCILIATION_CREDENTIAL_UNAVAILABLE",
        message:
          "The credential stored on this operation is unavailable and cannot be substituted.",
        status: 409,
      });
    }
    if (record.operation.type === "reschedule") {
      throw new AppError({
        code: "FACEBOOK_OPERATION_MANUAL_RESOLUTION_UNSUPPORTED",
        message:
          "Đổi lịch chỉ được chốt khi Facebook trả về đúng Post ID và thời gian mới.",
        status: 409,
      });
    }
    const previousCandidates = evidenceCandidates(
      record.operation.resolutionEvidence,
    );

    if (resolution.resolution === "remote_created") {
      if (!previousCandidates.includes(resolution.remotePostId)) {
        throw new AppError({
          code: "RECONCILIATION_EVIDENCE_REQUIRED",
          message:
            "Remote Post ID phải nằm trong danh sách candidate đã đọc từ Facebook.",
          status: 409,
        });
      }
      const metadata = this.metadataFor(record);
      const candidate = await this.findCandidateById(
        record,
        resolution.remotePostId,
        metadata,
        credentialAccess,
      );
      if (!candidate) {
        throw new AppError({
          code: "RECONCILIATION_CANDIDATE_STALE",
          message:
            "Candidate không còn xuất hiện trong dữ liệu Facebook hiện tại.",
          status: 409,
        });
      }
      const evidence = {
        ...this.buildEvidence(record, "manual_remote_created", [candidate]),
        note: resolution.note,
      };
      await this.persistSuccess({
        operationId,
        postId: record.post.id,
        kind: record.operation.type,
        remotePostId: candidate.remoteId,
        effectiveAt: this.effectiveDate(candidate, metadata),
        evidence,
        resolvedByUserId: actorUserId,
      });
      return {
        operationId,
        postId: record.post.id,
        status: "succeeded",
        resolution: "remote_created",
        remotePostId: candidate.remoteId,
        reason: "manual_remote_created",
      };
    }

    const previousReason = z
      .object({ reason: z.string().optional() })
      .safeParse(record.operation.resolutionEvidence);
    if (!previousReason.success || previousReason.data.reason !== "no_match") {
      throw new AppError({
        code: "RECONCILIATION_NO_MATCH_EVIDENCE_REQUIRED",
        message:
          "Phải chạy đối soát và nhận kết quả không có candidate trước khi xác nhận remote không được tạo.",
        status: 409,
      });
    }
    const evidence = {
      ...record.operation.resolutionEvidence,
      reason: "manual_remote_not_created",
      note: resolution.note,
      resolvedAt: this.now().toISOString(),
    };
    await this.persistence.fail({
      operationId,
      postId: record.post.id,
      evidence,
      resolvedByUserId: actorUserId,
    });
    return {
      operationId,
      postId: record.post.id,
      status: "failed",
      resolution: "remote_not_created",
      reason: "manual_remote_not_created",
    };
  }

  private async requireReviewable(operationId: string, manual = false) {
    const record = await this.persistence.load(operationId);
    if (!record) {
      throw new AppError({
        code: "FACEBOOK_OPERATION_NOT_FOUND",
        message: "Không tìm thấy operation cần đối soát.",
        status: 404,
      });
    }
    if (
      !["publish_now", "schedule", "reschedule"].includes(record.operation.type)
    ) {
      throw new AppError({
        code: "FACEBOOK_OPERATION_NOT_RECONCILABLE",
        message: "Loại operation này chưa hỗ trợ đối soát create.",
        status: 409,
      });
    }
    const allowed = manual
      ? record.operation.status === "needs_attention"
      : record.operation.status === "uncertain" ||
        record.operation.status === "needs_attention" ||
        (record.operation.status === "pending" &&
          record.operation.startedAt.getTime() <=
            this.now().getTime() - STALE_PENDING_MS);
    if (!allowed) {
      throw new AppError({
        code: "FACEBOOK_OPERATION_NOT_REVIEWABLE",
        message: "Operation chưa ở trạng thái cần đối soát.",
        status: 409,
      });
    }
    return record as ReviewRecord & {
      operation: FacebookOperationRecord & {
        type: "publish_now" | "schedule" | "reschedule";
      };
    };
  }

  private metadataFor(record: ReviewRecord) {
    const parsed = requestMetadataSchema.safeParse(
      record.operation.requestMetadata,
    );
    const metadata = parsed.success ? parsed.data : {};
    return {
      messageHash: metadata.messageHash ?? sha256(record.post.message),
      postType: metadata.postType ?? record.post.type,
      assetCount: metadata.assetCount ?? record.assetCount,
      scheduledFor:
        metadata.scheduledFor ?? record.post.scheduledAt?.toISOString() ?? null,
      remotePostId: metadata.remotePostId ?? record.post.remotePostId ?? null,
      previousScheduledFor:
        metadata.previousScheduledFor ??
        record.post.scheduledAt?.toISOString() ??
        null,
    };
  }

  private credentialAccessFor(
    record: ReviewRecord,
    actorUserId?: string,
  ): ReconciliationCredentialAccess {
    const source = record.operation.credentialSource;
    if (!source) return { kind: "admin_managed" };

    if (source === "user_connected" && !actorUserId) {
      return {
        kind: "needs_attention",
        reason: "actor_reconciliation_required",
      };
    }

    if (!record.operation.pageCredentialId) {
      return {
        kind: "needs_attention",
        reason: "credential_provenance_unavailable",
      };
    }
    if (source === "admin_managed" && !record.operation.facebookConnectionId) {
      return {
        kind: "needs_attention",
        reason: "credential_provenance_unavailable",
      };
    }
    if (source === "user_connected" && !record.operation.facebookConnectionId) {
      return {
        kind: "needs_attention",
        reason: "credential_provenance_unavailable",
      };
    }

    return {
      kind: "exact",
      provenance: {
        credentialId: record.operation.pageCredentialId,
        facebookConnectionId: record.operation.facebookConnectionId,
      },
    };
  }

  private async reconcileReschedule(
    record: ReviewRecord,
    metadata: ReturnType<ReconcileFacebookOperationService["metadataFor"]>,
    credentialAccess: Exclude<
      ReconciliationCredentialAccess,
      { kind: "needs_attention" }
    >,
  ): Promise<ReconciliationResult> {
    const { remotePostId, scheduledFor } = metadata;
    if (!remotePostId || !scheduledFor) {
      return this.storeRescheduleAttention(
        record,
        "missing_reschedule_evidence",
        [],
      );
    }

    const scan = await this.readAll(record, "scheduled", credentialAccess);
    if (scan.credentialUnavailable) {
      return this.storeRescheduleAttention(
        record,
        "credential_provenance_unavailable",
        [],
      );
    }
    const remote = scan.posts.find((post) => post.remoteId === remotePostId);
    if (!remote) {
      return this.storeRescheduleAttention(
        record,
        scan.complete ? "remote_schedule_missing" : "scan_incomplete",
        scan.posts,
      );
    }

    const actualTime = remote.effectiveAt
      ? new Date(remote.effectiveAt).getTime()
      : Number.NaN;
    const desiredTime = new Date(scheduledFor).getTime();
    if (
      !Number.isFinite(actualTime) ||
      Math.abs(actualTime - desiredTime) > 60_000
    ) {
      return this.storeRescheduleAttention(record, "remote_schedule_mismatch", [
        remote,
      ]);
    }

    const evidence = {
      ...this.buildEvidence(record, "remote_schedule_updated", [remote]),
      remotePostId,
      previousScheduledFor: metadata.previousScheduledFor,
      scheduledFor,
      remoteScheduledFor: remote.effectiveAt,
    };
    await this.persistence.rescheduleSucceeded({
      operationId: record.operation.id,
      postId: record.post.id,
      remotePostId,
      scheduledFor: new Date(scheduledFor),
      evidence,
    });
    return {
      operationId: record.operation.id,
      postId: record.post.id,
      status: "succeeded",
      resolution: "remote_updated",
      remotePostId,
      reason: "remote_schedule_updated",
    };
  }

  private async storeRescheduleAttention(
    record: ReviewRecord,
    reason: string,
    candidates: RemoteFacebookPost[],
  ): Promise<ReconciliationResult> {
    await this.persistence.rescheduleNeedsAttention({
      operationId: record.operation.id,
      evidence: {
        ...this.buildEvidence(record, reason, candidates),
        remotePostId:
          requestMetadataSchema.safeParse(record.operation.requestMetadata).data
            ?.remotePostId ?? record.post.remotePostId,
      },
    });
    return {
      operationId: record.operation.id,
      postId: record.post.id,
      status: "needs_attention",
      resolution: "unresolved",
      reason,
    };
  }

  private async findCandidates(
    record: ReviewRecord,
    metadata: ReturnType<ReconcileFacebookOperationService["metadataFor"]>,
    credentialAccess: Exclude<
      ReconciliationCredentialAccess,
      { kind: "needs_attention" }
    >,
  ) {
    const kind: RemotePostKind =
      record.operation.type === "schedule" ? "scheduled" : "published";
    const scan = await this.readAll(record, kind, credentialAccess);
    return {
      complete: scan.complete,
      credentialUnavailable: scan.credentialUnavailable,
      candidates: scan.posts.filter((post) =>
        this.matches(post, record, metadata),
      ),
    };
  }

  private async findCandidateById(
    record: ReviewRecord,
    remotePostId: string,
    metadata: ReturnType<ReconcileFacebookOperationService["metadataFor"]>,
    credentialAccess: Exclude<
      ReconciliationCredentialAccess,
      { kind: "needs_attention" }
    >,
  ) {
    const kind: RemotePostKind =
      record.operation.type === "schedule" ? "scheduled" : "published";
    const scan = await this.readAll(record, kind, credentialAccess);
    if (scan.credentialUnavailable) {
      throw new AppError({
        code: "RECONCILIATION_CREDENTIAL_UNAVAILABLE",
        message:
          "The credential stored on this operation is unavailable and cannot be substituted.",
        status: 409,
      });
    }
    return scan.posts.find(
      (post) =>
        post.remoteId === remotePostId && this.matches(post, record, metadata),
    );
  }

  private async readAll(
    record: ReviewRecord,
    kind: RemotePostKind,
    credentialAccess: Exclude<
      ReconciliationCredentialAccess,
      { kind: "needs_attention" }
    >,
  ) {
    const posts: RemoteFacebookPost[] = [];
    let after: string | undefined;
    let complete = false;
    for (let page = 0; page < MAX_REMOTE_PAGES; page += 1) {
      let result: Awaited<ReturnType<ReconciliationReader["list"]>>;
      try {
        result = await this.reader.list({
          localPageId: record.operation.pageId,
          kind,
          after,
          limit: 100,
          credentialProvenance:
            credentialAccess.kind === "exact"
              ? credentialAccess.provenance
              : undefined,
          window:
            kind === "published"
              ? {
                  since: new Date(
                    record.operation.startedAt.getTime() -
                      PUBLISHED_WINDOW_BEFORE_MS,
                  ),
                  until: new Date(
                    record.operation.startedAt.getTime() +
                      PUBLISHED_WINDOW_AFTER_MS,
                  ),
                }
              : undefined,
        });
      } catch (error) {
        if (
          error instanceof AppError &&
          !error.retryable &&
          CREDENTIAL_UNAVAILABLE_CODES.has(error.code)
        ) {
          return { posts, complete: false, credentialUnavailable: true };
        }
        throw error;
      }
      posts.push(...result.posts);
      if (!result.after) {
        complete = true;
        break;
      }
      after = result.after;
    }
    return { posts, complete, credentialUnavailable: false };
  }

  private matches(
    post: RemoteFacebookPost,
    record: ReviewRecord,
    metadata: ReturnType<ReconcileFacebookOperationService["metadataFor"]>,
  ) {
    if (sha256(post.message) !== metadata.messageHash) return false;
    if (post.mediaType !== metadata.postType) return false;
    if (
      metadata.postType !== "image" &&
      remoteAssetCount(post) !== metadata.assetCount
    ) {
      return false;
    }
    if (record.operation.type === "schedule") {
      if (!metadata.scheduledFor || !post.effectiveAt) return false;
      return (
        Math.abs(
          new Date(post.effectiveAt).getTime() -
            new Date(metadata.scheduledFor).getTime(),
        ) <= 60_000
      );
    }
    const createdAt = post.createdAt ?? post.effectiveAt;
    if (!createdAt) return false;
    const created = new Date(createdAt).getTime();
    return (
      created >=
        record.operation.startedAt.getTime() - PUBLISHED_WINDOW_BEFORE_MS &&
      created <=
        record.operation.startedAt.getTime() + PUBLISHED_WINDOW_AFTER_MS
    );
  }

  private effectiveDate(
    candidate: RemoteFacebookPost,
    metadata: ReturnType<ReconcileFacebookOperationService["metadataFor"]>,
  ) {
    const value =
      candidate.effectiveAt ??
      candidate.createdAt ??
      metadata.scheduledFor ??
      this.now().toISOString();
    return new Date(value);
  }

  private buildEvidence(
    record: ReviewRecord,
    reason: string,
    candidates: RemoteFacebookPost[],
  ) {
    return {
      version: 1,
      reason,
      checkedAt: this.now().toISOString(),
      requestFingerprint: record.operation.requestFingerprint,
      credentialSource: record.operation.credentialSource,
      candidates: candidates.slice(0, 10).map(safeCandidate),
    };
  }

  private async storeAttention(
    record: ReviewRecord,
    reason: string,
    candidates: RemoteFacebookPost[],
    message: string,
  ): Promise<ReconciliationResult> {
    await this.persistence.needsAttention({
      operationId: record.operation.id,
      postId: record.post.id,
      message,
      evidence: this.buildEvidence(record, reason, candidates),
    });
    return {
      operationId: record.operation.id,
      postId: record.post.id,
      status: "needs_attention",
      resolution: "unresolved",
      reason,
    };
  }

  private async persistSuccess(
    input: Parameters<ReconciliationPersistence["succeed"]>[0],
  ): Promise<void> {
    try {
      await this.persistence.succeed(input);
    } catch (error) {
      throw new AppError({
        code: "RECONCILIATION_LOCAL_PERSIST_FAILED",
        message:
          "Đã tìm thấy bằng chứng remote nhưng chưa lưu được trạng thái local; không được retry thao tác create.",
        status: 500,
        cause: error,
      });
    }
  }
}
