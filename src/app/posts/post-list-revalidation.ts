export type PostListKind = "drafts" | "scheduled" | "published";

export function canUsePostListMemoryCache(input: {
  memoryIsFresh: boolean;
  forceRefresh: boolean;
  revalidateAfterSubmission: boolean;
  revalidateOnMount: boolean;
}): boolean {
  return (
    input.memoryIsFresh &&
    !input.forceRefresh &&
    !input.revalidateAfterSubmission &&
    !input.revalidateOnMount
  );
}

function revalidationKey(pageId: string, kind: PostListKind): string {
  return `hancontent:posts:revalidate:${pageId}:${kind}`;
}

export function markPostListForRevalidation(
  pageId: string,
  kind: PostListKind,
): void {
  window.sessionStorage.setItem(revalidationKey(pageId, kind), "1");
}

export function needsPostListRevalidation(
  pageId: string,
  kind: PostListKind,
): boolean {
  return window.sessionStorage.getItem(revalidationKey(pageId, kind)) === "1";
}

export function clearPostListRevalidation(
  pageId: string,
  kind: PostListKind,
): void {
  window.sessionStorage.removeItem(revalidationKey(pageId, kind));
}
