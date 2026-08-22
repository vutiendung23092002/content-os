import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { AssetRepository } from "@/db/repositories/asset-repository";
import { assertRequestPageAccess } from "@/lib/access/page-access";
import { AppError } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { AssetStorage } from "@/modules/assets/asset-storage";
import { AssetCleanupService } from "@/modules/assets/asset-cleanup-service";

export const dynamic = "force-dynamic";

const pageIdSchema = z.uuid();
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumFileSize = 10 * 1024 * 1024;

function extensionFor(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  let uploadedStorageKey: string | undefined;
  let persistedAssetId: string | undefined;

  try {
    assertSameOrigin(request);
    const formData = await request.formData();
    const pageId = pageIdSchema.parse(formData.get("pageId"));
    const file = formData.get("file");
    await assertRequestPageAccess(request, pageId);

    if (!(file instanceof File)) {
      throw new AppError({
        code: "ASSET_FILE_REQUIRED",
        message: "Vui lòng chọn một ảnh.",
        status: 400,
      });
    }
    if (!allowedMimeTypes.has(file.type)) {
      throw new AppError({
        code: "ASSET_TYPE_INVALID",
        message: "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.",
        status: 400,
      });
    }
    if (file.size <= 0 || file.size > maximumFileSize) {
      throw new AppError({
        code: "ASSET_SIZE_INVALID",
        message: "Mỗi ảnh phải nhỏ hơn hoặc bằng 10 MB.",
        status: 400,
      });
    }

    const bytes = await file.arrayBuffer();
    const now = new Date();
    uploadedStorageKey = `${pageId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${extensionFor(file.type)}`;
    const storage = new AssetStorage();
    await storage.upload({
      storageKey: uploadedStorageKey,
      data: bytes,
      contentType: file.type,
    });

    const asset = await new AssetRepository(getDatabase()).create({
      pageId,
      storageKey: uploadedStorageKey,
      mimeType: file.type,
      fileSize: file.size,
      checksum: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
      originalFilename:
        file.name.slice(0, 255) || `image.${extensionFor(file.type)}`,
    });
    persistedAssetId = asset.id;
    const previewUrl = await storage.createSignedUrl(asset.storageKey);

    return NextResponse.json(
      {
        asset: {
          id: asset.id,
          name: asset.originalFilename,
          mimeType: asset.mimeType,
          fileSize: asset.fileSize,
          previewUrl,
        },
        requestId,
      },
      { status: 201 },
    );
  } catch (error) {
    if (persistedAssetId) {
      const cleaned = await new AssetCleanupService()
        .deleteUnattached(persistedAssetId)
        .catch(() => false);
      if (cleaned) uploadedStorageKey = undefined;
    }
    if (uploadedStorageKey) {
      await new AssetStorage()
        .remove(uploadedStorageKey)
        .catch(() => undefined);
    }
    return toErrorResponse(error, requestId);
  }
}
