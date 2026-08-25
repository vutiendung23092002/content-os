export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"] as const;

export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_VIDEO_FILE_SIZE = 50 * 1024 * 1024;

export function isImageMimeType(value: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function isVideoMimeType(value: string): boolean {
  return (VIDEO_MIME_TYPES as readonly string[]).includes(value);
}

export function extensionForMedia(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/mp4") return "mp4";
  throw new Error(`Unsupported media type: ${mimeType}`);
}
