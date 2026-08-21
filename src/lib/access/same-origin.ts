import "server-only";
import { AppError } from "@/lib/errors/app-error";

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ??
    firstHeaderValue(request.headers.get("host"));
  if (!origin || !host) {
    throw new AppError({
      code: "ORIGIN_REQUIRED",
      message: "Không xác minh được nguồn yêu cầu.",
      status: 403,
    });
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new AppError({
      code: "ORIGIN_INVALID",
      message: "Nguồn yêu cầu không hợp lệ.",
      status: 403,
    });
  }

  const forwardedProtocol = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  if (
    originUrl.host !== host ||
    (forwardedProtocol && originUrl.protocol !== `${forwardedProtocol}:`)
  ) {
    throw new AppError({
      code: "ORIGIN_MISMATCH",
      message: "Yêu cầu khác nguồn đã bị từ chối.",
      status: 403,
    });
  }
}
