import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { AssetRepository } from "@/db/repositories/asset-repository";
import { assertRequestPageAccess } from "@/lib/access/page-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { AppError } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/api-error";
import { parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { getAssetBucketName } from "@/lib/supabase/admin";
import { AssetStorage } from "@/modules/assets/asset-storage";
import { AssetCleanupService } from "@/modules/assets/asset-cleanup-service";
import {
  extensionForMedia,
  isVideoMimeType,
  MAX_VIDEO_FILE_SIZE,
} from "@/modules/assets/media-policy";

export const dynamic = "force-dynamic";

const intentSchema = z
  .object({
    action: z.literal("create"),
    pageId: z.uuid(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1),
    fileSize: z.number().int().positive().max(MAX_VIDEO_FILE_SIZE),
  })
  .strict();

const completeSchema = z
  .object({
    action: z.literal("complete"),
    assetId: z.uuid(),
    pageId: z.uuid(),
    storageKey: z.string().min(1).max(1024),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1),
    fileSize: z.number().int().positive().max(MAX_VIDEO_FILE_SIZE),
  })
  .strict();

const requestSchema = z.discriminatedUnion("action", [
  intentSchema,
  completeSchema,
]);

function validateVideo(mimeType: string, fileSize: number) {
  if (!isVideoMimeType(mimeType)) {
    throw new AppError({
      code: "VIDEO_TYPE_INVALID",
      message: "Chỉ hỗ trợ video MP4 hoặc MOV.",
      status: 400,
    });
  }
  if (fileSize <= 0 || fileSize > MAX_VIDEO_FILE_SIZE) {
    throw new AppError({
      code: "VIDEO_SIZE_INVALID",
      message: "Video phải nhỏ hơn hoặc bằng 50 MB.",
      status: 400,
    });
  }
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  let persistedAssetId: string | undefined;

  try {
    assertSameOrigin(request);
    const body = await parseJsonBody(request, requestSchema);

    if (body.action === "create") {
      const input = body;
      validateVideo(input.mimeType, input.fileSize);
      const actor = await assertRequestPageAccess(request, input.pageId);
      await assertMutationRateLimit({
        actor,
        pageId: input.pageId,
        action: "asset:video:create",
      });

      const now = new Date();
      const storageKey = `${input.pageId}/${now.getUTCFullYear()}/${String(
        now.getUTCMonth() + 1,
      ).padStart(2, "0")}/${randomUUID()}.${extensionForMedia(input.mimeType)}`;
      const asset = await new AssetRepository(getDatabase()).create({
        pageId: input.pageId,
        storageKey,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        checksum: createHash("sha256")
          .update(`${storageKey}:${input.fileSize}:${input.mimeType}`)
          .digest("hex"),
        originalFilename: input.fileName.slice(0, 255),
      });
      persistedAssetId = asset.id;
      const token = await new AssetStorage().createSignedUploadUrl(storageKey);
      persistedAssetId = undefined;

      return NextResponse.json({
        upload: {
          assetId: asset.id,
          bucket: getAssetBucketName(),
          storageKey,
          token,
        },
        requestId,
      });
    }

    const input = body;
    validateVideo(input.mimeType, input.fileSize);
    const actor = await assertRequestPageAccess(request, input.pageId);
    await assertMutationRateLimit({
      actor,
      pageId: input.pageId,
      action: "asset:video:complete",
    });
    if (!input.storageKey.startsWith(`${input.pageId}/`)) {
      throw new AppError({
        code: "VIDEO_STORAGE_KEY_INVALID",
        message: "Đường dẫn video không thuộc Page hiện tại.",
        status: 403,
      });
    }

    const storage = new AssetStorage();
    const asset = await new AssetRepository(getDatabase()).findById(
      input.assetId,
    );
    if (
      !asset ||
      asset.pageId !== input.pageId ||
      asset.storageKey !== input.storageKey ||
      asset.mimeType !== input.mimeType ||
      asset.fileSize !== input.fileSize
    ) {
      throw new AppError({
        code: "VIDEO_UPLOAD_INTENT_INVALID",
        message: "Phiên tải video không còn hợp lệ.",
        status: 409,
      });
    }
    persistedAssetId = asset.id;
    const info = await storage.info(input.storageKey);
    if (info.size !== input.fileSize || info.contentType !== input.mimeType) {
      throw new AppError({
        code: "VIDEO_UPLOAD_MISMATCH",
        message: "Video tải lên không khớp với tệp đã chọn.",
        status: 409,
      });
    }

    persistedAssetId = undefined;

    return NextResponse.json(
      {
        asset: {
          id: asset.id,
          name: asset.originalFilename,
          mimeType: asset.mimeType,
          fileSize: asset.fileSize,
          previewUrl: await storage.createSignedUrl(asset.storageKey),
        },
        requestId,
      },
      { status: 201 },
    );
  } catch (error) {
    if (persistedAssetId) {
      await new AssetCleanupService()
        .deleteUnattached(persistedAssetId)
        .catch(() => false);
    }
    return toErrorResponse(error, requestId);
  }
}
