import { describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "@/db/repositories/asset-repository";
import {
  ASSET_CLEANUP_CLAIM_TIMEOUT_MS,
  AssetCleanupService,
  ORPHAN_ASSET_GRACE_MS,
  SUCCESSFUL_IMAGE_RETENTION_MS,
  SUCCESSFUL_VIDEO_RETENTION_MS,
} from "./asset-cleanup-service";

function asset(id: string): AssetRecord {
  return {
    id,
    pageId: null,
    storageKey: `cleanup/${id}.jpg`,
    mimeType: "image/jpeg",
    fileSize: 1024,
    width: null,
    height: null,
    checksum: id.padEnd(64, "0"),
    originalFilename: `${id}.jpg`,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    cleanupClaimedAt: null,
    deletedAt: null,
  };
}

describe("AssetCleanupService", () => {
  it("claims and removes eligible objects with the configured windows", async () => {
    const now = new Date("2026-08-22T04:00:00.000Z");
    const candidates = [asset("published"), asset("orphan")];
    const repository = {
      listCleanupCandidates: vi.fn().mockResolvedValue(candidates),
      claimForCleanup: vi
        .fn()
        .mockImplementation(async (id: string) =>
          candidates.find((candidate) => candidate.id === id),
        ),
      restoreCleanupClaim: vi.fn().mockResolvedValue(true),
      finalizeCleanup: vi.fn().mockResolvedValue(true),
      claimUnattachedForDeletion: vi.fn().mockResolvedValue(undefined),
    };
    const storage = { remove: vi.fn().mockResolvedValue(undefined) };

    const result = await new AssetCleanupService(
      repository,
      storage,
      () => now,
    ).cleanup(25);

    expect(result).toEqual({ scanned: 2, deleted: 2, skipped: 0, failed: 0 });
    expect(repository.listCleanupCandidates).toHaveBeenCalledWith(
      {
        successfulImageBefore: new Date(
          now.getTime() - SUCCESSFUL_IMAGE_RETENTION_MS,
        ),
        successfulVideoBefore: new Date(
          now.getTime() - SUCCESSFUL_VIDEO_RETENTION_MS,
        ),
        orphanedBefore: new Date(now.getTime() - ORPHAN_ASSET_GRACE_MS),
        claimStaleBefore: new Date(
          now.getTime() - ASSET_CLEANUP_CLAIM_TIMEOUT_MS,
        ),
      },
      25,
    );
    expect(storage.remove).toHaveBeenCalledTimes(2);
    expect(repository.restoreCleanupClaim).not.toHaveBeenCalled();
    expect(repository.finalizeCleanup).toHaveBeenCalledTimes(2);
  });

  it("restores the claim when Supabase Storage deletion fails", async () => {
    const candidate = asset("failed-delete");
    const repository = {
      listCleanupCandidates: vi.fn().mockResolvedValue([candidate]),
      claimForCleanup: vi.fn().mockResolvedValue(candidate),
      restoreCleanupClaim: vi.fn().mockResolvedValue(true),
      finalizeCleanup: vi.fn().mockResolvedValue(true),
      claimUnattachedForDeletion: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      remove: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    };

    const result = await new AssetCleanupService(
      repository,
      storage,
      () => new Date("2026-08-22T04:00:00.000Z"),
    ).cleanup();

    expect(result).toEqual({ scanned: 1, deleted: 0, skipped: 0, failed: 1 });
    expect(repository.restoreCleanupClaim).toHaveBeenCalledWith(
      candidate.id,
      expect.any(Date),
    );
  });

  it("skips a candidate that is no longer eligible when claimed", async () => {
    const candidate = asset("became-attached");
    const repository = {
      listCleanupCandidates: vi.fn().mockResolvedValue([candidate]),
      claimForCleanup: vi.fn().mockResolvedValue(undefined),
      restoreCleanupClaim: vi.fn().mockResolvedValue(true),
      finalizeCleanup: vi.fn().mockResolvedValue(true),
      claimUnattachedForDeletion: vi.fn().mockResolvedValue(undefined),
    };
    const storage = { remove: vi.fn().mockResolvedValue(undefined) };

    const result = await new AssetCleanupService(repository, storage).cleanup();

    expect(result).toEqual({ scanned: 1, deleted: 0, skipped: 1, failed: 0 });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("deletes a newly orphaned asset immediately when requested", async () => {
    const candidate = asset("manual-remove");
    const repository = {
      listCleanupCandidates: vi.fn().mockResolvedValue([]),
      claimForCleanup: vi.fn().mockResolvedValue(undefined),
      restoreCleanupClaim: vi.fn().mockResolvedValue(true),
      finalizeCleanup: vi.fn().mockResolvedValue(true),
      claimUnattachedForDeletion: vi.fn().mockResolvedValue(candidate),
    };
    const storage = { remove: vi.fn().mockResolvedValue(undefined) };

    await expect(
      new AssetCleanupService(repository, storage).deleteUnattached(
        candidate.id,
      ),
    ).resolves.toBe(true);
    expect(storage.remove).toHaveBeenCalledWith(candidate.storageKey);
    expect(repository.finalizeCleanup).toHaveBeenCalled();
  });
});
