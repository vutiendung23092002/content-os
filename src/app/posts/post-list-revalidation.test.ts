import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canUsePostListMemoryCache,
  clearPostListRevalidation,
  markPostListForRevalidation,
  needsPostListRevalidation,
} from "./post-list-revalidation";

const storedValues = new Map<string, string>();

beforeEach(() => {
  storedValues.clear();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => storedValues.get(key) ?? null,
      removeItem: (key: string) => storedValues.delete(key),
      setItem: (key: string, value: string) => storedValues.set(key, value),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("post list revalidation", () => {
  it("revalidates local data on mount even when the memory cache is fresh", () => {
    expect(
      canUsePostListMemoryCache({
        memoryIsFresh: true,
        forceRefresh: false,
        revalidateAfterSubmission: false,
        revalidateOnMount: true,
      }),
    ).toBe(false);

    expect(
      canUsePostListMemoryCache({
        memoryIsFresh: true,
        forceRefresh: false,
        revalidateAfterSubmission: false,
        revalidateOnMount: false,
      }),
    ).toBe(true);
  });

  it("revalidates only the submitted page and tab until a successful load clears it", () => {
    markPostListForRevalidation("page-1", "published");

    expect(needsPostListRevalidation("page-1", "published")).toBe(true);
    expect(needsPostListRevalidation("page-1", "scheduled")).toBe(false);
    expect(needsPostListRevalidation("page-2", "published")).toBe(false);

    clearPostListRevalidation("page-1", "published");

    expect(needsPostListRevalidation("page-1", "published")).toBe(false);
  });
});
