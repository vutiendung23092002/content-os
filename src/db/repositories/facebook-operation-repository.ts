import { eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { facebookOperations } from "@/db/schema";

export type FacebookOperationRecord = typeof facebookOperations.$inferSelect;
export type FacebookOperationType = FacebookOperationRecord["type"];

export class FacebookOperationRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async createPending(input: {
    pageId: string;
    postId?: string;
    type: FacebookOperationType;
    requestFingerprint?: string;
  }): Promise<FacebookOperationRecord> {
    const [record] = await this.database
      .insert(facebookOperations)
      .values({
        pageId: input.pageId,
        postId: input.postId,
        type: input.type,
        status: "pending",
        requestFingerprint: input.requestFingerprint,
      })
      .returning();

    if (!record) {
      throw new Error("Failed to create Facebook operation");
    }

    return record;
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
}
