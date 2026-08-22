import "server-only";
import { timingSafeEqual } from "node:crypto";
import { requireServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors/app-error";

export function assertAssetCleanupAccess(request: Request): void {
  const expected = requireServerEnv("ASSET_CLEANUP_SECRET");
  if (expected.length < 32) {
    throw new AppError({
      code: "ASSET_CLEANUP_SECRET_INVALID",
      message: "Asset cleanup secret phải có ít nhất 32 ký tự.",
      status: 500,
    });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  const valid =
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes);

  if (!valid) {
    throw new AppError({
      code: "ASSET_CLEANUP_UNAUTHORIZED",
      message: "Không có quyền chạy dọn ảnh.",
      status: 401,
    });
  }
}
