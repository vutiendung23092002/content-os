import "server-only";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors/app-error";
import { getServerEnv } from "@/lib/env/server";

export const INTERNAL_ACCESS_HEADER = "x-han-access-secret";

function secretsMatch(expected: string, received: string | null): boolean {
  if (!received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function assertInternalAccess(request: Request): void {
  const env = getServerEnv();
  const expected = env.APP_ACCESS_SECRET;

  if (!expected && env.NODE_ENV !== "production") {
    return;
  }

  if (!expected) {
    throw new AppError({
      code: "ACCESS_NOT_CONFIGURED",
      message: "Lớp bảo vệ ứng dụng chưa được cấu hình.",
      status: 503,
    });
  }

  if (!secretsMatch(expected, request.headers.get(INTERNAL_ACCESS_HEADER))) {
    throw new AppError({
      code: "ACCESS_DENIED",
      message: "Không có quyền truy cập.",
      status: 401,
    });
  }
}
