import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./app-error";

export function toErrorResponse(error: unknown, requestId: string) {
  const normalized =
    error instanceof AppError
      ? error
      : error instanceof ZodError
        ? new AppError({
            code: "VALIDATION_ERROR",
            message: "Dữ liệu gửi lên không hợp lệ.",
            status: 400,
            cause: error,
          })
        : new AppError({
            code: "INTERNAL_ERROR",
            message: "Đã xảy ra lỗi nội bộ.",
            status: 500,
            cause: error,
          });

  return NextResponse.json(
    {
      error: {
        code: normalized.code,
        message: normalized.message,
        requestId,
        retryable: normalized.retryable,
      },
    },
    { status: normalized.status },
  );
}
