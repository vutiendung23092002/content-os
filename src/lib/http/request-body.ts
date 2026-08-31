import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";

export const MAX_JSON_BODY_BYTES = 128 * 1024;

function payloadTooLarge(): AppError {
  return new AppError({
    code: "PAYLOAD_TOO_LARGE",
    message: "Dữ liệu gửi lên vượt quá giới hạn cho phép.",
    status: 413,
  });
}

async function readBodyBytes(request: Request, maxBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw payloadTooLarge();
    }
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<z.output<Schema>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new AppError({
      code: "CONTENT_TYPE_INVALID",
      message: "Yêu cầu phải sử dụng application/json.",
      status: 415,
    });
  }

  const bytes = await readBodyBytes(request, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new AppError({
      code: "MALFORMED_JSON",
      message: "Dữ liệu JSON không hợp lệ.",
      status: 400,
      cause: error,
    });
  }
  return schema.parse(value);
}

export async function parseMultipartBody(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new AppError({
      code: "CONTENT_TYPE_INVALID",
      message: "Yêu cầu phải sử dụng multipart/form-data.",
      status: 415,
    });
  }

  const bytes = await readBodyBytes(request, maxBytes);
  return new Request(request.url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: bytes,
  }).formData();
}

export async function assertEmptyBody(request: Request): Promise<void> {
  if ((await readBodyBytes(request, 0)).byteLength !== 0) {
    throw new AppError({
      code: "REQUEST_BODY_NOT_ALLOWED",
      message: "Yêu cầu này không chấp nhận request body.",
      status: 400,
    });
  }
}
