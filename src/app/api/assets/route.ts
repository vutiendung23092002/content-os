import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { AssetRepository } from "@/db/repositories/asset-repository";
import { assertRequestPageAccess } from "@/lib/access/page-access";
import { AppError } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { parseMultipartBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { AssetStorage } from "@/modules/assets/asset-storage";
import { AssetCleanupService } from "@/modules/assets/asset-cleanup-service";
import { validateImageBytes } from "@/modules/assets/image-validator";
import {
  extensionForMedia,
  isImageMimeType,
  MAX_IMAGE_FILE_SIZE,
} from "@/modules/assets/media-policy";

export const dynamic = "force-dynamic";

const uploadSchema = z
  .object({
    pageId: z.uuid(),
    file: z.instanceof(File),
  })
  .strict();
const MAX_IMAGE_MULTIPART_BYTES = MAX_IMAGE_FILE_SIZE + 1024 * 1024;
export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  let uploadedStorageKey: string | undefined;
  let persistedAssetId: string | undefined;

  try {
    assertSameOrigin(request);
    const formData = await parseMultipartBody(
      request,
      MAX_IMAGE_MULTIPART_BYTES,
    );
    const { pageId, file } = uploadSchema.parse(
      Object.fromEntries(formData.entries()),
    );
    const actor = await assertRequestPageAccess(request, pageId);
    await assertMutationRateLimit({
      actor,
      pageId,
      action: "asset:image:upload",
    });

    if (!(file instanceof File)) {
      throw new AppError({
        code: "ASSET_FILE_REQUIRED",
        message: "Vui lòng chọn một ảnh.",
        status: 400,
      });
    }
    if (!isImageMimeType(file.type)) {
      throw new AppError({
        code: "ASSET_TYPE_INVALID",
        message: "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.",
        status: 400,
      });
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_FILE_SIZE) {
      throw new AppError({
        code: "ASSET_SIZE_INVALID",
        message: "Mỗi ảnh phải nhỏ hơn hoặc bằng 10 MB.",
        status: 400,
      });
    }

    const bytes = await file.arrayBuffer();
    const image = validateImageBytes(bytes, file.type);
    const now = new Date();
    uploadedStorageKey = `${pageId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${extensionForMedia(image.mimeType)}`;
    const storage = new AssetStorage();
    await storage.upload({
      storageKey: uploadedStorageKey,
      data: bytes,
      contentType: image.mimeType,
    });

    const asset = await new AssetRepository(getDatabase()).create({
      pageId,
      storageKey: uploadedStorageKey,
      mimeType: image.mimeType,
      fileSize: file.size,
      width: image.width,
      height: image.height,
      checksum: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
      originalFilename:
        file.name.slice(0, 255) || `image.${extensionForMedia(image.mimeType)}`,
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
          width: asset.width,
          height: asset.height,
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
