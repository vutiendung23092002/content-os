import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { facebookOperations, postAssets, posts } from "@/db/schema";

export type PostRecord = typeof posts.$inferSelect;

export type CreateDraftInput = {
  pageId: string;
  message: string;
  type: "text" | "image" | "video";
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

export type MarkMissingRemotePostsInput = {
  pageId: string;
  kind: "published" | "scheduled";
  windowStart: Date;
  windowEnd: Date;
  seenRemotePostIds: string[];
  missingGraceBefore: Date;
};

export class PostRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async createDraft(input: CreateDraftInput): Promise<PostRecord> {
    const [record] = await this.database
      .insert(posts)
      .values({
        pageId: input.pageId,
        message: input.message,
        type: input.type,
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
    const remotePostIds = Array.from(
      new Set(inputs.map((input) => input.remotePostId)),
    );

    await this.database
      .update(posts)
      .set({
        status: sql`case
          when ${posts.status} = 'scheduled' then 'canceled'::"hancontent_os"."post_status"
          else 'deleted_remote'::"hancontent_os"."post_status"
        end`,
        lastSyncedAt: syncedAt,
        updatedAt: syncedAt,
      })
      .where(
        and(
          inArray(posts.remotePostId, remotePostIds),
          sql`${posts.status} in ('scheduled', 'published')`,
          sql`exists (
            select 1
            from ${facebookOperations}
            where ${facebookOperations.postId} = ${posts.id}
              and ${facebookOperations.remotePostId} = ${posts.remotePostId}
              and ${facebookOperations.type} = 'cancel'
              and ${facebookOperations.status} = 'succeeded'
          )`,
        ),
      );

    await this.database
      .insert(posts)
      .values(
        inputs.map((input) => ({
          pageId: input.pageId,
          remotePostId: input.remotePostId,
          type:
            input.snapshot.mediaType === "video"
              ? ("video" as const)
              : input.snapshot.imageUrl
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
          type: sql`case when ${posts.type} = 'video' then ${posts.type} else excluded.type end`,
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
        setWhere: sql`${posts.status} not in ('canceled', 'deleted_remote')`,
      });

    // A video upload returns a Video ID while Page feeds expose the associated
    // Feed Post ID. Successful cancel operations are recorded with the latter,
    // so a later sync must tombstone a newly discovered feed row as well.
    await this.database
      .update(posts)
      .set({
        status: sql`case
          when ${posts.status} = 'scheduled' then 'canceled'::"hancontent_os"."post_status"
          else 'deleted_remote'::"hancontent_os"."post_status"
        end`,
        lastSyncedAt: syncedAt,
        updatedAt: syncedAt,
      })
      .where(
        and(
          inArray(posts.remotePostId, remotePostIds),
          sql`${posts.status} in ('scheduled', 'published')`,
          sql`exists (
            select 1
            from ${facebookOperations}
            where ${facebookOperations.pageId} = ${posts.pageId}
              and ${facebookOperations.remotePostId} = ${posts.remotePostId}
              and ${facebookOperations.type} = 'cancel'
              and ${facebookOperations.status} = 'succeeded'
          )`,
        ),
      );
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

  async markMissingRemotePosts(
    input: MarkMissingRemotePostsInput,
  ): Promise<number> {
    const syncedAt = new Date();

    const effectiveAt =
      input.kind === "scheduled" ? posts.scheduledAt : posts.publishedAt;

    const missingRemoteFilter =
      input.seenRemotePostIds.length > 0
        ? notInArray(posts.remotePostId, input.seenRemotePostIds)
        : sql<boolean>`true`;

    const updated = await this.database
      .update(posts)
      .set({
        status: input.kind === "scheduled" ? "canceled" : "deleted_remote",
        lastSyncedAt: syncedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: syncedAt,
      })
      .where(
        and(
          eq(posts.pageId, input.pageId),
          eq(posts.status, input.kind),
          gte(effectiveAt, input.windowStart),
          lt(effectiveAt, input.windowEnd),

          // Bài local không còn xuất hiện trong snapshot Meta.
          missingRemoteFilter,

          // Tránh tombstone một post vừa mới được tạo mà Meta
          // chưa kịp expose qua /posts hoặc /scheduled_posts.
          or(
            isNotNull(posts.lastSyncedAt),
            lte(posts.updatedAt, input.missingGraceBefore),
          ),
        ),
      )
      .returning({ id: posts.id });

    return updated.length;
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

  async updateScheduledTime(
    id: string,
    remotePostId: string,
    scheduledAt: Date,
  ): Promise<boolean> {
    const syncedAt = new Date();
    const updated = await this.database
      .update(posts)
      .set({
        scheduledAt,
        remoteUpdatedAt: syncedAt,
        lastSyncedAt: syncedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: syncedAt,
      })
      .where(
        and(
          eq(posts.id, id),
          eq(posts.status, "scheduled"),
          eq(posts.remotePostId, remotePostId),
        ),
      )
      .returning({ id: posts.id });
    return updated.length === 1;
  }

  async updateRemoteMessage(
    id: string,
    remotePostId: string,
    message: string,
  ): Promise<boolean> {
    const syncedAt = new Date();
    const updated = await this.database
      .update(posts)
      .set({
        message,
        remoteUpdatedAt: syncedAt,
        lastSyncedAt: syncedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: syncedAt,
      })
      .where(
        and(
          eq(posts.id, id),
          sql`${posts.status} in ('scheduled', 'published')`,
          eq(posts.remotePostId, remotePostId),
        ),
      )
      .returning({ id: posts.id });
    return updated.length === 1;
  }

  async markRemoteRemoved(
    id: string,
    pageId: string,
    remotePostId: string,
    previousStatus: "scheduled" | "published",
    remotePostAliases: string[] = [],
  ): Promise<boolean> {
    const syncedAt = new Date();
    const updated = await this.database
      .update(posts)
      .set({
        status: previousStatus === "scheduled" ? "canceled" : "deleted_remote",
        lastSyncedAt: syncedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: syncedAt,
      })
      .where(
        and(
          eq(posts.id, id),
          eq(posts.status, previousStatus),
          eq(posts.remotePostId, remotePostId),
        ),
      )
      .returning({ id: posts.id });

    const aliases = Array.from(
      new Set(remotePostAliases.filter((alias) => alias !== remotePostId)),
    );
    if (aliases.length > 0) {
      await this.database
        .update(posts)
        .set({
          status: sql`case
            when ${posts.status} = 'scheduled' then 'canceled'::"hancontent_os"."post_status"
            else 'deleted_remote'::"hancontent_os"."post_status"
          end`,
          lastSyncedAt: syncedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: syncedAt,
        })
        .where(
          and(
            eq(posts.pageId, pageId),
            inArray(posts.remotePostId, aliases),
            sql`${posts.status} in ('scheduled', 'published')`,
          ),
        );
    }
    return updated.length === 1;
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

  async markNeedsAttention(id: string, message: string): Promise<void> {
    await this.database
      .update(posts)
      .set({
        status: "needs_attention",
        lastErrorCode: "RECONCILIATION_REQUIRED",
        lastErrorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  }

  async markReconciledPublished(
    id: string,
    remotePostId: string,
    publishedAt: Date,
  ): Promise<void> {
    await this.database
      .update(posts)
      .set({
        status: "published",
        remotePostId,
        publishedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  }
}
