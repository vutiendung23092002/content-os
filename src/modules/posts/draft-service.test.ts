import { describe, expect, it, vi } from "vitest";
import type { PageRecord } from "@/db/repositories/page-repository";
import type { PostRecord } from "@/db/repositories/post-repository";
import {
  type DraftAssetReader,
  DraftService,
  type DraftStore,
  type PageReader,
} from "./draft-service";

const pageId = "018f0d44-35f0-7b63-99d2-c1b9222cd05c";
const postId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";
const assetId = "018f0d44-35f0-7b63-99d2-c1b9222cd05e";
const assetIds = Array.from(
  { length: 11 },
  (_, index) =>
    `018f0d44-35f0-7b63-99d2-${(index + 100).toString().padStart(12, "0")}`,
);

function activePage(): PageRecord {
  const now = new Date();
  return {
    id: pageId,
    externalPageId: "external-page",
    name: "Page One",
    username: null,
    avatarUrl: null,
    category: null,
    timezone: null,
    isActive: true,
    connectionStatus: "active",
    lastSyncedAt: now,
    remoteMetadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

function draft(): PostRecord {
  const now = new Date();
  return {
    id: postId,
    pageId,
    remotePostId: null,
    type: "text",
    message: "Draft caption",
    status: "draft",
    scheduledAt: null,
    publishedAt: null,
    remoteCreatedAt: null,
    remoteUpdatedAt: null,
    lastSyncedAt: null,
    remoteSnapshot: {},
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createStores(page: PageRecord | undefined = activePage()) {
  const pages: PageReader = { findById: vi.fn().mockResolvedValue(page) };
  const drafts: DraftStore = {
    createDraft: vi.fn().mockResolvedValue(draft()),
    findById: vi.fn().mockResolvedValue(draft()),
    listDrafts: vi.fn().mockResolvedValue([draft()]),
    updateDraft: vi.fn().mockResolvedValue(draft()),
    deleteDraft: vi.fn().mockResolvedValue(true),
  };
  return { pages, drafts };
}

describe("DraftService", () => {
  it("creates a draft only for an active Page", async () => {
    const stores = createStores();
    const service = new DraftService(stores.pages, stores.drafts);

    await expect(
      service.create({ pageId, message: "Draft caption" }),
    ).resolves.toMatchObject({
      status: "draft",
    });
    expect(stores.drafts.createDraft).toHaveBeenCalledWith({
      pageId,
      message: "Draft caption",
      type: "text",
      assetIds: [],
    });
  });

  it("rejects a Page that is not connected", async () => {
    const stores = createStores({
      ...activePage(),
      connectionStatus: "expired",
    });
    const service = new DraftService(stores.pages, stores.drafts);

    await expect(
      service.create({ pageId, message: "Draft caption" }),
    ).rejects.toMatchObject({
      code: "PAGE_NOT_ACTIVE",
    });
  });

  it("allows an image-only draft and preserves asset order", async () => {
    const stores = createStores();
    const assets: DraftAssetReader = {
      findAttachableByIds: vi
        .fn()
        .mockResolvedValue([{ id: assetId, mimeType: "image/jpeg" }]),
    };
    const service = new DraftService(stores.pages, stores.drafts, assets);

    await service.create({ pageId, message: "", assetIds: [assetId] });

    expect(assets.findAttachableByIds).toHaveBeenCalledWith(pageId, [assetId]);
    expect(stores.drafts.createDraft).toHaveBeenCalledWith({
      pageId,
      message: "",
      type: "image",
      assetIds: [assetId],
    });
  });

  it("creates a video draft from exactly one video asset", async () => {
    const stores = createStores();
    const assets: DraftAssetReader = {
      findAttachableByIds: vi
        .fn()
        .mockResolvedValue([{ id: assetId, mimeType: "video/mp4" }]),
    };
    const service = new DraftService(stores.pages, stores.drafts, assets);

    await service.create({ pageId, message: "Video", assetIds: [assetId] });

    expect(stores.drafts.createDraft).toHaveBeenCalledWith({
      pageId,
      message: "Video",
      type: "video",
      assetIds: [assetId],
    });
  });

  it("accepts ten images and preserves their order", async () => {
    const stores = createStores();
    const acceptedIds = assetIds.slice(0, 10);
    const assets: DraftAssetReader = {
      findAttachableByIds: vi
        .fn()
        .mockResolvedValue(
          acceptedIds.map((id) => ({ id, mimeType: "image/png" })),
        ),
    };
    const service = new DraftService(stores.pages, stores.drafts, assets);

    await service.create({ pageId, message: "Album", assetIds: acceptedIds });

    expect(stores.drafts.createDraft).toHaveBeenCalledWith({
      pageId,
      message: "Album",
      type: "image",
      assetIds: acceptedIds,
    });
  });

  it("rejects more than ten assets before reading the database", async () => {
    const stores = createStores();
    const assets: DraftAssetReader = {
      findAttachableByIds: vi.fn(),
    };
    const service = new DraftService(stores.pages, stores.drafts, assets);

    await expect(
      service.create({ pageId, message: "Too many", assetIds }),
    ).rejects.toBeDefined();
    expect(assets.findAttachableByIds).not.toHaveBeenCalled();
    expect(stores.drafts.createDraft).not.toHaveBeenCalled();
  });

  it("rejects duplicate asset IDs", async () => {
    const stores = createStores();
    const assets: DraftAssetReader = {
      findAttachableByIds: vi.fn(),
    };
    const service = new DraftService(stores.pages, stores.drafts, assets);

    await expect(
      service.create({
        pageId,
        message: "Duplicates",
        assetIds: [assetId, assetId],
      }),
    ).rejects.toBeDefined();
    expect(assets.findAttachableByIds).not.toHaveBeenCalled();
  });

  it("rejects mixed image and video media", async () => {
    const stores = createStores();
    const mixedIds = assetIds.slice(0, 2);
    const assets: DraftAssetReader = {
      findAttachableByIds: vi.fn().mockResolvedValue([
        { id: mixedIds[0]!, mimeType: "image/jpeg" },
        { id: mixedIds[1]!, mimeType: "video/mp4" },
      ]),
    };
    const service = new DraftService(stores.pages, stores.drafts, assets);

    await expect(
      service.create({ pageId, message: "Mixed", assetIds: mixedIds }),
    ).rejects.toMatchObject({ code: "DRAFT_MEDIA_MIX_INVALID" });
    expect(stores.drafts.createDraft).not.toHaveBeenCalled();
  });

  it("rejects media that does not belong to the selected Page", async () => {
    const stores = createStores();
    const assets: DraftAssetReader = {
      findAttachableByIds: vi.fn().mockResolvedValue([]),
    };
    const service = new DraftService(stores.pages, stores.drafts, assets);

    await expect(
      service.create({ pageId, message: "Caption", assetIds: [assetId] }),
    ).rejects.toMatchObject({ code: "DRAFT_ASSET_INVALID" });
    expect(stores.drafts.createDraft).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only content", async () => {
    const stores = createStores();
    const service = new DraftService(stores.pages, stores.drafts);

    await expect(
      service.create({ pageId, message: "   " }),
    ).rejects.toBeDefined();
    expect(stores.drafts.createDraft).not.toHaveBeenCalled();
  });

  it("reports an optimistic update conflict", async () => {
    const stores = createStores();
    vi.mocked(stores.drafts.updateDraft).mockResolvedValue(undefined);
    const service = new DraftService(stores.pages, stores.drafts);

    await expect(
      service.update(postId, { message: "Changed caption" }),
    ).rejects.toMatchObject({
      code: "DRAFT_CONFLICT",
    });
  });
});
