import { and, desc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { posts } from "@/db/schema";

export type PostRecord = typeof posts.$inferSelect;

export type CreateDraftInput = {
  pageId: string;
  message: string;
};

export type UpdateDraftInput = {
  message: string;
  expectedUpdatedAt?: Date;
};

export class PostRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async createDraft(input: CreateDraftInput): Promise<PostRecord> {
    const [record] = await this.database
      .insert(posts)
      .values({
        pageId: input.pageId,
        message: input.message,
        type: "text",
        status: "draft",
      })
      .returning();

    if (!record) {
      throw new Error("Failed to create draft");
    }

    return record;
  }

  async findById(id: string): Promise<PostRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);
    return record;
  }

  async listDrafts(pageId?: string, limit = 50): Promise<PostRecord[]> {
    const filters = [eq(posts.status, "draft")];
    if (pageId) filters.push(eq(posts.pageId, pageId));

    return this.database
      .select()
      .from(posts)
      .where(and(...filters))
      .orderBy(desc(posts.updatedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  }

  async updateDraft(
    id: string,
    input: UpdateDraftInput,
  ): Promise<PostRecord | undefined> {
    const filters = [eq(posts.id, id), eq(posts.status, "draft")];
    if (input.expectedUpdatedAt)
      filters.push(eq(posts.updatedAt, input.expectedUpdatedAt));

    const [record] = await this.database
      .update(posts)
      .set({ message: input.message, updatedAt: new Date() })
      .where(and(...filters))
      .returning();
    return record;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const deleted = await this.database
      .delete(posts)
      .where(and(eq(posts.id, id), eq(posts.status, "draft")))
      .returning({ id: posts.id });
    return deleted.length === 1;
  }

  async claimDraftForSubmission(id: string): Promise<PostRecord | undefined> {
    const [record] = await this.database
      .update(posts)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(and(eq(posts.id, id), eq(posts.status, "draft")))
      .returning();
    return record;
  }

  async markPublished(id: string, remotePostId: string): Promise<void> {
    await this.database
      .update(posts)
      .set({
        status: "published",
        remotePostId,
        publishedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  }

  async markScheduled(
    id: string,
    remotePostId: string,
    scheduledAt: Date,
  ): Promise<void> {
    await this.database
      .update(posts)
      .set({
        status: "scheduled",
        remotePostId,
        scheduledAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  }

  async markSubmissionFailed(
    id: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.database
      .update(posts)
      .set({
        status: "failed",
        lastErrorCode: code,
        lastErrorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  }

  async markSubmissionUncertain(id: string, code: string): Promise<void> {
    await this.database
      .update(posts)
      .set({
        status: "uncertain",
        lastErrorCode: code,
        lastErrorMessage: "Cần đối soát trạng thái remote trước khi thử lại.",
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  }
}
