import "server-only";
import { getDatabase } from "@/db/client";
import {
  AssetRepository,
  type AssetCleanupWindow,
  type AssetRecord,
} from "@/db/repositories/asset-repository";
import { AppError } from "@/lib/errors/app-error";
import { AssetStorage } from "./asset-storage";

export const PUBLISHED_ASSET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const ORPHAN_ASSET_GRACE_MS = 60 * 60 * 1000;
export const ASSET_CLEANUP_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

export type AssetCleanupRepository = {
  listCleanupCandidates(
    window: AssetCleanupWindow,
    limit: number,
  ): Promise<AssetRecord[]>;
  claimForCleanup(
    id: string,
    window: AssetCleanupWindow,
    claimedAt: Date,
  ): Promise<AssetRecord | undefined>;
  restoreCleanupClaim(id: string, claimedAt: Date): Promise<boolean>;
  finalizeCleanup(
    id: string,
    claimedAt: Date,
    deletedAt: Date,
  ): Promise<boolean>;
  claimUnattachedForDeletion(
    id: string,
    claimedAt: Date,
    claimStaleBefore: Date,
  ): Promise<AssetRecord | undefined>;
};

export type AssetCleanupStorage = {
  remove(storageKey: string): Promise<void>;
};

export type AssetCleanupResult = {
  scanned: number;
  deleted: number;
  skipped: number;
  failed: number;
};

export class AssetCleanupService {
  constructor(
    private readonly repository: AssetCleanupRepository = new AssetRepository(
      getDatabase(),
    ),
    private readonly storage: AssetCleanupStorage = new AssetStorage(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async cleanup(limit = 50): Promise<AssetCleanupResult> {
    const runAt = this.now();
    const window: AssetCleanupWindow = {
      publishedBefore: new Date(runAt.getTime() - PUBLISHED_ASSET_RETENTION_MS),
      orphanedBefore: new Date(runAt.getTime() - ORPHAN_ASSET_GRACE_MS),
      claimStaleBefore: new Date(
        runAt.getTime() - ASSET_CLEANUP_CLAIM_TIMEOUT_MS,
      ),
    };
    const candidates = await this.repository.listCleanupCandidates(
      window,
      limit,
    );
    const result: AssetCleanupResult = {
      scanned: candidates.length,
      deleted: 0,
      skipped: 0,
      failed: 0,
    };

    for (const candidate of candidates) {
      const claimedAt = new Date(runAt);
      const claimed = await this.repository.claimForCleanup(
        candidate.id,
        window,
        claimedAt,
      );
      if (!claimed) {
        result.skipped += 1;
        continue;
      }

      try {
        await this.storage.remove(claimed.storageKey);
        const finalized = await this.repository.finalizeCleanup(
          claimed.id,
          claimedAt,
          runAt,
        );
        if (finalized) result.deleted += 1;
        else result.failed += 1;
      } catch {
        await this.repository
          .restoreCleanupClaim(claimed.id, claimedAt)
          .catch(() => false);
        result.failed += 1;
      }
    }

    return result;
  }

  async deleteUnattached(id: string): Promise<boolean> {
    const runAt = this.now();
    const claimed = await this.repository.claimUnattachedForDeletion(
      id,
      runAt,
      new Date(runAt.getTime() - ASSET_CLEANUP_CLAIM_TIMEOUT_MS),
    );
    if (!claimed) return false;

    try {
      await this.storage.remove(claimed.storageKey);
      const finalized = await this.repository.finalizeCleanup(
        claimed.id,
        runAt,
        runAt,
      );
      if (!finalized) {
        throw new AppError({
          code: "ASSET_CLEANUP_FINALIZE_FAILED",
          message:
            "Ảnh đã được xóa khỏi Storage nhưng chưa chốt được metadata.",
          status: 500,
        });
      }
      return true;
    } catch (error) {
      await this.repository
        .restoreCleanupClaim(claimed.id, runAt)
        .catch(() => false);
      throw error;
    }
  }
}
