import { describe, expect, it } from "vitest";
import { MAX_IMAGE_DIMENSION, validateImageBytes } from "./image-validator";

function uint32be(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function uint32le(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function png(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...uint32be(13),
    73,
    72,
    68,
    82,
    ...uint32be(width),
    ...uint32be(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...uint32be(0),
    73,
    69,
    78,
    68,
    0,
    0,
    0,
    0,
  ]);
}

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

function webp(width: number, height: number): Uint8Array {
  const payload = [
    0,
    0,
    0,
    0,
    (width - 1) & 0xff,
    ((width - 1) >>> 8) & 0xff,
    ((width - 1) >>> 16) & 0xff,
    (height - 1) & 0xff,
    ((height - 1) >>> 8) & 0xff,
    ((height - 1) >>> 16) & 0xff,
  ];
  const body = [
    87,
    69,
    66,
    80,
    86,
    80,
    56,
    88,
    ...uint32le(payload.length),
    ...payload,
  ];
  return Uint8Array.from([82, 73, 70, 70, ...uint32le(body.length), ...body]);
}

describe("validateImageBytes", () => {
  it.each([
    ["JPEG", jpeg(1280, 720), "image/jpeg", 1280, 720],
    ["PNG", png(640, 480), "image/png", 640, 480],
    ["WebP", webp(1920, 1080), "image/webp", 1920, 1080],
  ] as const)(
    "accepts a valid %s and reads dimensions",
    (_, bytes, mimeType, width, height) => {
      expect(validateImageBytes(bytes, mimeType)).toEqual({
        mimeType,
        width,
        height,
      });
    },
  );

  it("rejects content spoofed as an image", () => {
    expect(() =>
      validateImageBytes(
        new TextEncoder().encode("not an image"),
        "image/jpeg",
      ),
    ).toThrowError(expect.objectContaining({ code: "ASSET_CONTENT_INVALID" }));
  });

  it("rejects a declared MIME type that differs from the signature", () => {
    expect(() => validateImageBytes(png(10, 10), "image/jpeg")).toThrowError(
      expect.objectContaining({ code: "ASSET_MIME_MISMATCH" }),
    );
  });

  it("rejects a truncated image", () => {
    const bytes = png(10, 10);
    expect(() =>
      validateImageBytes(bytes.subarray(0, bytes.length - 5), "image/png"),
    ).toThrowError(expect.objectContaining({ code: "ASSET_CONTENT_INVALID" }));
  });

  it("rejects dimensions above the safety limit", () => {
    expect(() =>
      validateImageBytes(png(MAX_IMAGE_DIMENSION + 1, 1), "image/png"),
    ).toThrowError(
      expect.objectContaining({ code: "ASSET_DIMENSIONS_INVALID" }),
    );
  });

  it("rejects excessive total pixels", () => {
    expect(() =>
      validateImageBytes(png(20_000, 20_000), "image/png"),
    ).toThrowError(
      expect.objectContaining({ code: "ASSET_DIMENSIONS_INVALID" }),
    );
  });
});
