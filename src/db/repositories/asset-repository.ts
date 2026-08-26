import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { assets, facebookOperations, postAssets, posts } from "@/db/schema";

export type AssetRecord = typeof assets.$inferSelect;

export type CreateAssetInput = {
  pageId: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  originalFilename: string;
  width?: number;
  height?: number;
};

export type PostAssetRecord = AssetRecord & {
  sortOrder: number;
  remoteMediaId: string | null;
};

export type AssetCleanupWindow = {
  successfulImageBefore: Date;
  successfulVideoBefore: Date;
  orphanedBefore: Date;
  claimStaleBefore: Date;
};

function cleanupEligibility(window: AssetCleanupWindow) {
  return sql<boolean>`(
    (
      ${assets.createdAt} <= ${sql.param(window.orphanedBefore, assets.createdAt)}
      and not exists (
        select 1 from ${postAssets}
        where ${postAssets.assetId} = ${assets.id}
      )
    )
    or
    (
      exists (
        select 1 from ${postAssets}
        where ${postAssets.assetId} = ${assets.id}
      )
      and not exists (
        select 1
        from ${postAssets}
        inner join ${posts} on ${posts.id} = ${postAssets.postId}
        where ${postAssets.assetId} = ${assets.id}
          and (
            ${posts.status} not in ('scheduled', 'published')
            or ${posts.remotePostId} is null
            or not exists (
              select 1
              from ${facebookOperations}
              where ${facebookOperations.postId} = ${posts.id}
                and ${facebookOperations.status} = 'succeeded'
                and ${facebookOperations.finishedAt} is not null
                and (
                  (
                    ${assets.mimeType} like 'video/%'
                    and ${facebookOperations.finishedAt} <= ${sql.param(window.successfulVideoBefore, facebookOperations.finishedAt)}
                  )
                  or
                  (
                    ${assets.mimeType} not like 'video/%'
                    and ${facebookOperations.finishedAt} <= ${sql.param(window.successfulImageBefore, facebookOperations.finishedAt)}
                  )
                )
            )
          )
      )
    )
  )`;
}

export class AssetRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async create(input: CreateAssetInput): Promise<AssetRecord> {
    const [record] = await this.database
      .insert(assets)
      .values(input)
      .returning();
    if (!record) throw new Error("Failed to create asset");
    return record;
  }

  async findById(id: string): Promise<AssetRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), isNull(assets.deletedAt)))
      .limit(1);
    return record;
  }

  async findAttachableByIds(
    pageId: string,
    ids: string[],
  ): Promise<AssetRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.database
      .select({ asset: assets, attachedAssetId: postAssets.assetId })
      .from(assets)
      .leftJoin(postAssets, eq(postAssets.assetId, assets.id))
      .where(
        and(
          inArray(assets.id, ids),
          eq(assets.pageId, pageId),
          isNull(assets.deletedAt),
          isNull(assets.cleanupClaimedAt),
        ),
      );

    return rows
      .filter((row) => row.attachedAssetId === null)
      .map((row) => row.asset);
  }

  async listForPost(postId: string): Promise<PostAssetRecord[]> {
    const rows = await this.database
      .select({
        asset: assets,
        sortOrder: postAssets.sortOrder,
        remoteMediaId: postAssets.remoteMediaId,
      })
      .from(postAssets)
      .innerJoin(assets, eq(assets.id, postAssets.assetId))
      .where(and(eq(postAssets.postId, postId), isNull(assets.deletedAt)))
      .orderBy(asc(postAssets.sortOrder));

    return rows.map((row) => ({
      ...row.asset,
      sortOrder: row.sortOrder,
      remoteMediaId: row.remoteMediaId,
    }));
  }

  async setRemoteMediaIds(
    postId: string,
    remoteMediaIds: string[],
  ): Promise<void> {
    for (const [sortOrder, remoteMediaId] of remoteMediaIds.entries()) {
      const [updated] = await this.database
        .update(postAssets)
        .set({ remoteMediaId })
        .where(
          and(
            eq(postAssets.postId, postId),
            eq(postAssets.sortOrder, sortOrder),
          ),
        )
        .returning({ assetId: postAssets.assetId });

      if (!updated) {
        throw new Error(
          `Missing attached asset at sort order ${sortOrder} for remote media`,
        );
      }
    }
  }

  async listCleanupCandidates(
    window: AssetCleanupWindow,
    limit: number,
  ): Promise<AssetRecord[]> {
    return this.database
      .select()
      .from(assets)
      .where(
        and(
          isNull(assets.deletedAt),
          or(
            isNull(assets.cleanupClaimedAt),
            lt(assets.cleanupClaimedAt, window.claimStaleBefore),
          ),
          cleanupEligibility(window),
        ),
      )
      .orderBy(asc(assets.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  }

  async claimForCleanup(
    id: string,
    window: AssetCleanupWindow,
    claimedAt: Date,
  ): Promise<AssetRecord | undefined> {
    const [record] = await this.database
      .update(assets)
      .set({ cleanupClaimedAt: claimedAt })
      .where(
        and(
          eq(assets.id, id),
          isNull(assets.deletedAt),
          or(
            isNull(assets.cleanupClaimedAt),
            lt(assets.cleanupClaimedAt, window.claimStaleBefore),
          ),
          cleanupEligibility(window),
        ),
      )
      .returning();
    return record;
  }

  async restoreCleanupClaim(id: string, claimedAt: Date): Promise<boolean> {
    const restored = await this.database
      .update(assets)
      .set({ cleanupClaimedAt: null })
      .where(
        and(
          eq(assets.id, id),
          eq(assets.cleanupClaimedAt, claimedAt),
          isNull(assets.deletedAt),
        ),
      )
      .returning({ id: assets.id });
    return restored.length === 1;
  }

  async finalizeCleanup(
    id: string,
    claimedAt: Date,
    deletedAt: Date,
  ): Promise<boolean> {
    const finalized = await this.database
      .update(assets)
      .set({ cleanupClaimedAt: null, deletedAt })
      .where(
        and(
          eq(assets.id, id),
          eq(assets.cleanupClaimedAt, claimedAt),
          isNull(assets.deletedAt),
        ),
      )
      .returning({ id: assets.id });
    return finalized.length === 1;
  }

  async claimUnattachedForDeletion(
    id: string,
    claimedAt: Date,
    claimStaleBefore: Date,
  ): Promise<AssetRecord | undefined> {
    const unattached = sql<boolean>`not exists (
      select 1 from ${postAssets}
      where ${postAssets.assetId} = ${assets.id}
    )`;
    const [record] = await this.database
      .update(assets)
      .set({ cleanupClaimedAt: claimedAt })
      .where(
        and(
          eq(assets.id, id),
          isNull(assets.deletedAt),
          or(
            isNull(assets.cleanupClaimedAt),
            lt(assets.cleanupClaimedAt, claimStaleBefore),
          ),
          unattached,
        ),
      )
      .returning();
    return record;
  }
}
