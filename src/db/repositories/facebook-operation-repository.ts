import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { facebookOperations } from "@/db/schema";

export type FacebookOperationRecord = typeof facebookOperations.$inferSelect;
export type FacebookOperationType = FacebookOperationRecord["type"];
export type FacebookOperationCredentialProvenance = {
  credentialSource: NonNullable<FacebookOperationRecord["credentialSource"]>;
  facebookConnectionId: string | null;
  pageCredentialId: string;
  actorUserId?: string;
};

export class FacebookOperationRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async createPending(input: {
    pageId: string;
    postId?: string;
    type: FacebookOperationType;
    requestFingerprint?: string;
    requestMetadata?: Record<string, unknown>;
    credentialProvenance?: FacebookOperationCredentialProvenance;
  }): Promise<FacebookOperationRecord> {
    const [record] = await this.database
      .insert(facebookOperations)
      .values({
        pageId: input.pageId,
        postId: input.postId,
        type: input.type,
        status: "pending",
        requestFingerprint: input.requestFingerprint,
        requestMetadata: input.requestMetadata ?? {},
        credentialSource: input.credentialProvenance?.credentialSource,
        facebookConnectionId: input.credentialProvenance?.facebookConnectionId,
        pageCredentialId: input.credentialProvenance?.pageCredentialId,
        actorUserId: input.credentialProvenance?.actorUserId,
      })
      .returning();

    if (!record) {
      throw new Error("Failed to create Facebook operation");
    }

    return record;
  }

  async findById(id: string): Promise<FacebookOperationRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(facebookOperations)
      .where(eq(facebookOperations.id, id))
      .limit(1);
    return record;
  }

  async listReviewable(input: {
    stalePendingBefore: Date;
    limit?: number;
  }): Promise<FacebookOperationRecord[]> {
    return this.database
      .select()
      .from(facebookOperations)
      .where(
        or(
          inArray(facebookOperations.status, ["uncertain", "needs_attention"]),
          and(
            eq(facebookOperations.status, "pending"),
            lt(facebookOperations.startedAt, input.stalePendingBefore),
          ),
        ),
      )
      .orderBy(desc(facebookOperations.startedAt))
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 100));
  }

  async markSucceeded(id: string, remotePostId?: string): Promise<void> {
    await this.database
      .update(facebookOperations)
      .set({ status: "succeeded", remotePostId, finishedAt: new Date() })
      .where(eq(facebookOperations.id, id));
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    await this.database
      .update(facebookOperations)
      .set({
        status: "failed",
        providerErrorCode: code,
        providerErrorMessage: message,
        finishedAt: new Date(),
      })
      .where(eq(facebookOperations.id, id));
  }

  async markUncertain(id: string, code: string): Promise<void> {
    await this.database
      .update(facebookOperations)
      .set({
        status: "uncertain",
        providerErrorCode: code,
        finishedAt: new Date(),
      })
      .where(eq(facebookOperations.id, id));
  }

  async markNeedsAttention(
    id: string,
    evidence: Record<string, unknown>,
  ): Promise<void> {
    await this.database
      .update(facebookOperations)
      .set({
        status: "needs_attention",
        resolution: "unresolved",
        resolutionEvidence: evidence,
        resolvedAt: null,
      })
      .where(eq(facebookOperations.id, id));
  }

  async markReconciledSucceeded(input: {
    id: string;
    remotePostId: string;
    evidence: Record<string, unknown>;
    resolvedByUserId?: string;
  }): Promise<void> {
    await this.database
      .update(facebookOperations)
      .set({
        status: "succeeded",
        remotePostId: input.remotePostId,
        resolution: "remote_created",
        resolutionEvidence: input.evidence,
        resolvedByUserId: input.resolvedByUserId,
        resolvedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(eq(facebookOperations.id, input.id));
  }

  async markReconciledMutationSucceeded(input: {
    id: string;
    remotePostId: string;
    evidence: Record<string, unknown>;
  }): Promise<void> {
    await this.database
      .update(facebookOperations)
      .set({
        status: "succeeded",
        remotePostId: input.remotePostId,
        resolution: "remote_updated",
        resolutionEvidence: input.evidence,
        resolvedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(eq(facebookOperations.id, input.id));
  }

  async markReconciledFailed(input: {
    id: string;
    evidence: Record<string, unknown>;
    resolvedByUserId?: string;
  }): Promise<void> {
    await this.database
      .update(facebookOperations)
      .set({
        status: "failed",
        providerErrorCode: "REMOTE_NOT_CREATED",
        providerErrorMessage:
          "Đối soát không tìm thấy bài remote; không tự động retry.",
        resolution: "remote_not_created",
        resolutionEvidence: input.evidence,
        resolvedByUserId: input.resolvedByUserId,
        resolvedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(eq(facebookOperations.id, input.id));
  }
}
