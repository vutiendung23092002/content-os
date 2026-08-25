import "server-only";
import { AppError } from "@/lib/errors/app-error";

const FACEBOOK_POST_ID_PATTERN = /^\d+_\d+$/;
const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
]);

export function facebookPostObjectUrl(remotePostId: string): URL {
  if (!FACEBOOK_POST_ID_PATTERN.test(remotePostId)) {
    throw new AppError({
      code: "INVALID_FACEBOOK_POST_ID",
      message: "Post ID Facebook không hợp lệ.",
      status: 400,
    });
  }

  return new URL(`https://www.facebook.com/${remotePostId}`);
}

function safeFacebookRedirect(
  location: string | null,
  fallback: URL,
): URL | null {
  if (!location) return null;

  try {
    const target = new URL(location, fallback);
    if (target.protocol !== "https:" || !FACEBOOK_HOSTS.has(target.hostname)) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}

export async function resolveFacebookPostUrl(
  remotePostId: string,
  request: typeof fetch = fetch,
): Promise<URL> {
  const objectUrl = facebookPostObjectUrl(remotePostId);

  try {
    const response = await request(objectUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(4_000),
    });
    return (
      safeFacebookRedirect(response.headers.get("location"), objectUrl) ??
      objectUrl
    );
  } catch {
    return objectUrl;
  }
}
