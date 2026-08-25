import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  assertRequestPageAccess: vi.fn(),
  createAsset: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  deleteUnattached: vi.fn(),
}));

vi.mock("@/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/lib/access/same-origin", () => ({
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/lib/access/page-access", () => ({
  assertRequestPageAccess: mocks.assertRequestPageAccess,
}));
vi.mock("@/db/repositories/asset-repository", () => ({
  AssetRepository: class {
    create = mocks.createAsset;
  },
}));
vi.mock("@/modules/assets/asset-storage", () => ({
  AssetStorage: class {
    upload = mocks.upload;
    createSignedUrl = mocks.createSignedUrl;
    remove = mocks.remove;
  },
}));
vi.mock("@/modules/assets/asset-cleanup-service", () => ({
  AssetCleanupService: class {
    deleteUnattached = mocks.deleteUnattached;
  },
}));

import { POST } from "./route";

const pageId = "018f0d44-35f0-7b63-99d2-c1b9222cd05c";
const assetId = "018f0d44-35f0-7b63-99d2-c1b9222cd05e";

function png(width: number, height: number): Uint8Array {
  const u32 = (value: number) => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...u32(13),
    73,
    72,
    68,
    82,
    ...u32(width),
    ...u32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u32(0),
    73,
    69,
    78,
    68,
    0,
    0,
    0,
    0,
  ]);
}

function requestFor(file: File): Request {
  const formData = new FormData();
  formData.set("pageId", pageId);
  formData.set("file", file);
  return new Request("https://social.example/api/assets", {
    method: "POST",
    body: formData,
    headers: { "x-request-id": "route-test" },
  });
}

describe("POST /api/assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertRequestPageAccess.mockResolvedValue(undefined);
    mocks.upload.mockResolvedValue(undefined);
    mocks.createSignedUrl.mockResolvedValue("https://signed.example/image");
    mocks.remove.mockResolvedValue(undefined);
    mocks.deleteUnattached.mockResolvedValue(true);
    mocks.createAsset.mockImplementation(
      async (input: Record<string, unknown>) => ({
        id: assetId,
        pageId,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        width: input.width,
        height: input.height,
        checksum: input.checksum,
        originalFilename: input.originalFilename,
        createdAt: new Date(),
        cleanupClaimedAt: null,
        deletedAt: null,
      }),
    );
  });

  it("validates image bytes and persists their real dimensions", async () => {
    const bytes = png(1200, 630);
    const file = new File([bytes.buffer as ArrayBuffer], "cover.png", {
      type: "image/png",
    });

    const response = await POST(requestFor(file));

    expect(response.status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId,
        mimeType: "image/png",
        width: 1200,
        height: 630,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      asset: { id: assetId, width: 1200, height: 630 },
      requestId: "route-test",
    });
  });

  it("rejects spoofed content before uploading anything", async () => {
    const file = new File(["not an image"], "spoofed.jpg", {
      type: "image/jpeg",
    });

    const response = await POST(requestFor(file));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ASSET_CONTENT_INVALID" },
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rejects an oversized file before reading or uploading it", async () => {
    const file = new File(
      [new ArrayBuffer(10 * 1024 * 1024 + 1)],
      "large.png",
      {
        type: "image/png",
      },
    );

    const response = await POST(requestFor(file));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ASSET_SIZE_INVALID" },
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });
});
