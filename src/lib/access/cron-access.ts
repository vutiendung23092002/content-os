import "server-only";
import { timingSafeEqual } from "node:crypto";
import { requireServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors/app-error";

function assertCronBearerAccess(input: {
  request: Request;
  envKey: "ASSET_CLEANUP_SECRET" | "FACEBOOK_CRON_SECRET";
  codePrefix: "ASSET_CLEANUP" | "FACEBOOK_CRON";
  label: string;
}): void {
  const expected = requireServerEnv(input.envKey);
  if (expected.length < 32) {
    throw new AppError({
      code: `${input.codePrefix}_SECRET_INVALID`,
      message: `${input.label} secret phải có ít nhất 32 ký tự.`,
      status: 500,
    });
  }

  const authorization = input.request.headers.get("authorization") ?? "";
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
      code: `${input.codePrefix}_UNAUTHORIZED`,
      message: `Không có quyền chạy ${input.label.toLocaleLowerCase()}.`,
      status: 401,
    });
  }
}

export function assertAssetCleanupAccess(request: Request): void {
  assertCronBearerAccess({
    request,
    envKey: "ASSET_CLEANUP_SECRET",
    codePrefix: "ASSET_CLEANUP",
    label: "Asset cleanup",
  });
}

export function assertFacebookCronAccess(request: Request): void {
  assertCronBearerAccess({
    request,
    envKey: "FACEBOOK_CRON_SECRET",
    codePrefix: "FACEBOOK_CRON",
    label: "Facebook cron",
  });
}
