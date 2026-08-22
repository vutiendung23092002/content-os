import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { postAssets, posts } from "@/db/schema";

export type PostRecord = typeof posts.$inferSelect;

export type CreateDraftInput = {
  pageId: string;
  message: string;
  assetIds?: string[];
};

export type UpdateDraftInput = {
  message: string;
  expectedUpdatedAt?: Date;
};

export type RemotePostCacheInput = {
  pageId: string;
  remotePostId: string;
  kind: "published" | "scheduled";
  message: string;
  effectiveAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  snapshot: Record<string, unknown>;
};

export class PostRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async createDraft(input: CreateDraftInput): Promise<PostRecord> {
    const [record] = await this.database
      .insert(posts)
      .values({
        pageId: input.pageId,
        message: input.message,
        type: input.assetIds?.length ? "image" : "text",
        status: "draft",
      })
      .returning();

    if (!record) {
      throw new Error("Failed to create draft");
    }

    if (input.assetIds?.length) {
      await this.database.insert(postAssets).values(
        input.assetIds.map((assetId, sortOrder) => ({
          postId: record.id,
          assetId,
          sortOrder,
        })),
      );
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

  async upsertRemotePosts(inputs: RemotePostCacheInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const syncedAt = new Date();

    await this.database
      .insert(posts)
      .values(
        inputs.map((input) => ({
          pageId: input.pageId,
          remotePostId: input.remotePostId,
          type: input.snapshot.imageUrl
            ? ("image" as const)
            : ("text" as const),
          message: input.message,
          status: input.kind,
          scheduledAt: input.kind === "scheduled" ? input.effectiveAt : null,
          publishedAt: input.kind === "published" ? input.effectiveAt : null,
          remoteCreatedAt: input.createdAt,
          remoteUpdatedAt: input.updatedAt,
          lastSyncedAt: syncedAt,
          remoteSnapshot: input.snapshot,
        })),
      )
      .onConflictDoUpdate({
        target: [posts.pageId, posts.remotePostId],
        targetWhere: sql`${posts.remotePostId} is not null`,
        set: {
          type: sql`excluded.type`,
          message: sql`excluded.message`,
          status: sql`excluded.status`,
          scheduledAt: sql`excluded.scheduled_at`,
          publishedAt: sql`excluded.published_at`,
          remoteCreatedAt: sql`excluded.remote_created_at`,
          remoteUpdatedAt: sql`excluded.remote_updated_at`,
          lastSyncedAt: syncedAt,
          remoteSnapshot: sql`excluded.remote_snapshot`,
          updatedAt: syncedAt,
        },
      });
  }

  async listRemoteWindow(
    pageId: string,
    kind: "published" | "scheduled",
    windowStart: Date,
    windowEnd: Date,
  ): Promise<PostRecord[]> {
    const effectiveAt =
      kind === "scheduled" ? posts.scheduledAt : posts.publishedAt;
    return this.database
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.pageId, pageId),
          eq(posts.status, kind),
          gte(effectiveAt, windowStart),
          lt(effectiveAt, windowEnd),
        ),
      )
      .orderBy(desc(effectiveAt));
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
