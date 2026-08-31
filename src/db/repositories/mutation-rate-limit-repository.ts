import { lt, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { mutationRateLimits } from "@/db/schema";

export type MutationRateLimitIncrement = {
  actorId: string;
  pageScope: string;
  action: string;
  windowStart: Date;
  expiresAt: Date;
};

export class MutationRateLimitRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async increment(input: MutationRateLimitIncrement): Promise<number> {
    const now = new Date();
    await this.database
      .delete(mutationRateLimits)
      .where(lt(mutationRateLimits.expiresAt, now));

    const [record] = await this.database
      .insert(mutationRateLimits)
      .values({ ...input, requestCount: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          mutationRateLimits.actorId,
          mutationRateLimits.pageScope,
          mutationRateLimits.action,
          mutationRateLimits.windowStart,
        ],
        set: {
          requestCount: sql`${mutationRateLimits.requestCount} + 1`,
          expiresAt: input.expiresAt,
          updatedAt: now,
        },
      })
      .returning({ requestCount: mutationRateLimits.requestCount });

    if (!record) throw new Error("Failed to update mutation rate limit");
    return record.requestCount;
  }
}
