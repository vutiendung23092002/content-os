import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";
import { AssetRepository } from "@/db/repositories/asset-repository";
import { assertRequestPageAccess } from "@/lib/access/page-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { AppError } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/api-error";
import { AssetCleanupService } from "@/modules/assets/asset-cleanup-service";

type RouteContext = { params: Promise<{ assetId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertSameOrigin(request);
    const { assetId } = await context.params;
    const repository = new AssetRepository(getDatabase());
    const asset = await repository.findById(assetId);
    if (!asset?.pageId) {
      throw new AppError({
        code: "ASSET_NOT_FOUND",
        message: "Không tìm thấy ảnh.",
        status: 404,
      });
    }
    await assertRequestPageAccess(request, asset.pageId);
    const deleted = await new AssetCleanupService().deleteUnattached(asset.id);
    if (!deleted) {
      throw new AppError({
        code: "ASSET_IN_USE",
        message: "Ảnh đã được gắn vào một bài viết.",
        status: 409,
      });
    }
    return NextResponse.json({ success: true, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
