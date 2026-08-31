import { describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/lib/auth/types";
import {
  assertMutationRateLimit,
  type MutationRateLimitStore,
} from "./mutation-rate-limit";

const actor: Viewer = {
  id: "018f0d44-35f0-7b63-99d2-c1b9222cd060",
  externalUserId: "google-1",
  email: "actor@example.com",
  name: "Actor",
  role: "member",
  approvalStatus: "approved",
  isBootstrapSuperAdmin: false,
};

describe("mutation rate limiting", () => {
  it("keys the counter by actor, Page and action", async () => {
    const increment = vi.fn().mockResolvedValue(1);

    await assertMutationRateLimit({
      actor,
      pageId: "018f0d44-35f0-7b63-99d2-c1b9222cd061",
      action: "post:publish",
      now: new Date("2026-08-31T01:02:03.000Z"),
      store: { increment } as MutationRateLimitStore,
    });

    expect(increment).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.id,
        pageScope: "018f0d44-35f0-7b63-99d2-c1b9222cd061",
        action: "post:publish",
      }),
    );
  });

  it("rejects a request after the action policy is exceeded", async () => {
    const store: MutationRateLimitStore = {
      increment: vi.fn().mockResolvedValue(11),
    };

    await expect(
      assertMutationRateLimit({
        actor,
        pageId: "018f0d44-35f0-7b63-99d2-c1b9222cd061",
        action: "post:publish",
        store,
      }),
    ).rejects.toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      status: 429,
      retryable: true,
    });
  });

  it("leaves machine-auth requests unchanged when no browser actor exists", async () => {
    const increment = vi.fn();

    await assertMutationRateLimit({
      actor: undefined,
      action: "facebook:pages:sync",
      store: { increment } as MutationRateLimitStore,
    });

    expect(increment).not.toHaveBeenCalled();
  });
});
