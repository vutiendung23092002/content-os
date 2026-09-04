import "server-only";
import { getDatabase } from "@/db/client";
import { MutationRateLimitRepository } from "@/db/repositories/mutation-rate-limit-repository";
import type { Viewer } from "@/lib/auth/types";
import { AppError } from "@/lib/errors/app-error";

export const mutationActions = [
  "admin:user:create",
  "admin:user:approval",
  "admin:user:pages",
  "admin:user:role",
  "asset:image:upload",
  "asset:image:upload:preflight",
  "asset:video:complete",
  "asset:video:create",
  "asset:delete",
  "facebook:operation:reconcile",
  "facebook:operation:resolve",
  "facebook:page:add",
  "facebook:page:check",
  "facebook:pages:sync",
  "facebook:connection:disconnect",
  "facebook:connection:pages",
  "page:delete",
  "post:draft:create",
  "post:draft:delete",
  "post:draft:update",
  "post:message:update",
  "post:publish",
  "post:remote:delete",
  "post:reschedule",
  "post:schedule",
] as const;

export type MutationAction = (typeof mutationActions)[number];

type RateLimitPolicy = { limit: number; windowMs: number };

const ONE_MINUTE = 60_000;
const DEFAULT_POLICY: RateLimitPolicy = { limit: 30, windowMs: ONE_MINUTE };
const policies: Partial<Record<MutationAction, RateLimitPolicy>> = {
  "asset:image:upload": { limit: 20, windowMs: ONE_MINUTE },
  "asset:video:create": { limit: 10, windowMs: ONE_MINUTE },
  "asset:video:complete": { limit: 10, windowMs: ONE_MINUTE },
  "post:publish": { limit: 10, windowMs: ONE_MINUTE },
  "post:schedule": { limit: 10, windowMs: ONE_MINUTE },
  "post:reschedule": { limit: 10, windowMs: ONE_MINUTE },
  "post:remote:delete": { limit: 10, windowMs: ONE_MINUTE },
};

export type MutationRateLimitStore = {
  increment(input: {
    actorId: string;
    pageScope: string;
    action: MutationAction;
    windowStart: Date;
    expiresAt: Date;
  }): Promise<number>;
};

export async function assertMutationRateLimit(input: {
  actor: Viewer | undefined;
  pageId?: string;
  action: MutationAction;
  now?: Date;
  store?: MutationRateLimitStore;
}): Promise<void> {
  if (!input.actor) return;

  const policy = policies[input.action] ?? DEFAULT_POLICY;
  const now = input.now ?? new Date();
  const windowStartMs =
    Math.floor(now.getTime() / policy.windowMs) * policy.windowMs;
  const count = await (
    input.store ?? new MutationRateLimitRepository(getDatabase())
  ).increment({
    actorId: input.actor.id,
    pageScope: input.pageId ?? "global",
    action: input.action,
    windowStart: new Date(windowStartMs),
    expiresAt: new Date(windowStartMs + policy.windowMs),
  });

  if (count > policy.limit) {
    throw new AppError({
      code: "RATE_LIMIT_EXCEEDED",
      message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
      status: 429,
      retryable: true,
    });
  }
}
