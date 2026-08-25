import { AppError } from "@/lib/errors/app-error";
import { isImageMimeType } from "./media-policy";

export const MAX_IMAGE_DIMENSION = 30_000;
export const MAX_IMAGE_PIXELS = 100_000_000;

export type ValidatedImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};

function invalidImage(
  message = "Tệp ảnh bị hỏng hoặc không đúng định dạng.",
): never {
  throw new AppError({
    code: "ASSET_CONTENT_INVALID",
    message,
    status: 400,
  });
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) invalidImage();
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) invalidImage();
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 3 > bytes.length) invalidImage();
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) invalidImage();
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) invalidImage();
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function matches(
  bytes: Uint8Array,
  offset: number,
  expected: number[],
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) invalidImage();
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function parsePng(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!matches(bytes, 0, signature)) return undefined;
  if (bytes.length < 45) invalidImage();

  let offset = 8;
  let width: number | undefined;
  let height: number | undefined;
  let sawIend = false;

  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) invalidImage();

    if (offset === 8 && (type !== "IHDR" || length !== 13)) invalidImage();
    if (type === "IHDR") {
      width = readUint32BE(bytes, offset + 8);
      height = readUint32BE(bytes, offset + 12);
    }
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) invalidImage();
      sawIend = true;
      break;
    }
    offset = chunkEnd;
  }

  if (!sawIend || width === undefined || height === undefined) invalidImage();
  return { width, height };
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpeg(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (!matches(bytes, 0, [0xff, 0xd8])) return undefined;
  if (bytes.length < 12 || !matches(bytes, bytes.length - 2, [0xff, 0xd9])) {
    invalidImage();
  }

  let offset = 2;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) invalidImage();
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length - 1) invalidImage();
    const marker = bytes[offset] ?? 0;
    offset += 1;

    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;

    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length - 2) {
      invalidImage();
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) invalidImage();
      return {
        height: readUint16BE(bytes, offset + 3),
        width: readUint16BE(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }

  invalidImage("Không đọc được kích thước của ảnh JPEG.");
}

function parseWebp(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (ascii(bytes, 0, Math.min(4, bytes.length)) !== "RIFF") return undefined;
  if (bytes.length < 30 || ascii(bytes, 8, 4) !== "WEBP") invalidImage();
  if (readUint32LE(bytes, 4) + 8 !== bytes.length) invalidImage();

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = readUint32LE(bytes, offset + 4);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + length;
    if (chunkEnd > bytes.length) invalidImage();

    if (type === "VP8X") {
      if (length < 10) invalidImage();
      return {
        width: readUint24LE(bytes, dataOffset + 4) + 1,
        height: readUint24LE(bytes, dataOffset + 7) + 1,
      };
    }
    if (type === "VP8L") {
      if (length < 5 || bytes[dataOffset] !== 0x2f) invalidImage();
      const bits = readUint32LE(bytes, dataOffset + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (type === "VP8 ") {
      if (length < 10 || !matches(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])) {
        invalidImage();
      }
      return {
        width: readUint16LE(bytes, dataOffset + 6) & 0x3fff,
        height: readUint16LE(bytes, dataOffset + 8) & 0x3fff,
      };
    }

    offset = chunkEnd + (length % 2);
  }

  invalidImage("Không đọc được kích thước của ảnh WebP.");
}

function assertSafeDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new AppError({
      code: "ASSET_DIMENSIONS_INVALID",
      message: "Kích thước hoặc tổng số điểm ảnh vượt giới hạn an toàn.",
      status: 400,
    });
  }
}

export function validateImageBytes(
  input: ArrayBuffer | Uint8Array,
  declaredMimeType: string,
): ValidatedImage {
  if (!isImageMimeType(declaredMimeType)) {
    throw new AppError({
      code: "ASSET_TYPE_INVALID",
      message: "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.",
      status: 400,
    });
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let detectedMimeType: ValidatedImage["mimeType"] | undefined;
  let dimensions = parsePng(bytes);
  if (dimensions) {
    detectedMimeType = "image/png";
  } else {
    dimensions = parseJpeg(bytes);
    if (dimensions) {
      detectedMimeType = "image/jpeg";
    } else {
      dimensions = parseWebp(bytes);
      if (dimensions) detectedMimeType = "image/webp";
    }
  }

  if (!detectedMimeType || !dimensions) invalidImage();
  if (detectedMimeType !== declaredMimeType) {
    throw new AppError({
      code: "ASSET_MIME_MISMATCH",
      message: "Định dạng thực tế của ảnh không khớp loại tệp đã khai báo.",
      status: 400,
    });
  }

  assertSafeDimensions(dimensions.width, dimensions.height);
  return {
    mimeType: detectedMimeType,
    width: dimensions.width,
    height: dimensions.height,
  };
}
