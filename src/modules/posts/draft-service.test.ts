import { describe, expect, it, vi } from "vitest";
import type { PageRecord } from "@/db/repositories/page-repository";
import type { PostRecord } from "@/db/repositories/post-repository";
import {
  DraftService,
  type DraftStore,
  type PageReader,
} from "./draft-service";

const pageId = "018f0d44-35f0-7b63-99d2-c1b9222cd05c";
const postId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";

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
