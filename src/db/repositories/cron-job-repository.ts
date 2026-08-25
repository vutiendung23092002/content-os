import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { cronJobs } from "@/db/schema";

export type CronJobRecord = typeof cronJobs.$inferSelect;

export class CronJobRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async claim(input: {
    jobKey: string;
    owner: string;
    now: Date;
    leaseMs: number;
  }): Promise<CronJobRecord | undefined> {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const [record] = await this.database
      .insert(cronJobs)
      .values({
        jobKey: input.jobKey,
        leaseOwner: input.owner,
        leaseExpiresAt,
        lastStartedAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: cronJobs.jobKey,
        set: {
          leaseOwner: input.owner,
          leaseExpiresAt,
          lastStartedAt: input.now,
          updatedAt: input.now,
        },
        setWhere: or(
          isNull(cronJobs.leaseOwner),
          isNull(cronJobs.leaseExpiresAt),
          lt(cronJobs.leaseExpiresAt, input.now),
        ),
      })
      .returning();
    return record;
  }

  async checkpoint(input: {
    jobKey: string;
    owner: string;
    cursor: string | null;
    now: Date;
    leaseMs: number;
  }): Promise<boolean> {
    const records = await this.database
      .update(cronJobs)
      .set({
        cursor: input.cursor,
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(cronJobs.jobKey, input.jobKey),
          eq(cronJobs.leaseOwner, input.owner),
        ),
      )
      .returning({ jobKey: cronJobs.jobKey });
    return records.length === 1;
  }

  async complete(input: {
    jobKey: string;
    owner: string;
    cursor: string | null;
    now: Date;
  }): Promise<boolean> {
    const records = await this.database
      .update(cronJobs)
      .set({
        cursor: input.cursor,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSuccessAt: input.now,
        lastError: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(cronJobs.jobKey, input.jobKey),
          eq(cronJobs.leaseOwner, input.owner),
        ),
      )
      .returning({ jobKey: cronJobs.jobKey });
    return records.length === 1;
  }

  async fail(input: {
    jobKey: string;
    owner: string;
    error: Record<string, unknown>;
    now: Date;
  }): Promise<boolean> {
    const records = await this.database
      .update(cronJobs)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: input.error,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(cronJobs.jobKey, input.jobKey),
          eq(cronJobs.leaseOwner, input.owner),
        ),
      )
      .returning({ jobKey: cronJobs.jobKey });
    return records.length === 1;
  }
}
