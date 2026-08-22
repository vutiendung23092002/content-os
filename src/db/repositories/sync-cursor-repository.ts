import { and, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { syncCursors } from "@/db/schema";

export type SyncCursorRecord = typeof syncCursors.$inferSelect;

export class SyncCursorRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async find(
    pageId: string,
    syncType: string,
  ): Promise<SyncCursorRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(syncCursors)
      .where(
        and(eq(syncCursors.pageId, pageId), eq(syncCursors.syncType, syncType)),
      )
      .limit(1);
    return record;
  }

  async markSuccess(input: {
    pageId: string;
    syncType: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<void> {
    const now = new Date();
    await this.database
      .insert(syncCursors)
      .values({
        pageId: input.pageId,
        syncType: input.syncType,
        cursor: null,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        lastSuccessAt: now,
        lastError: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [syncCursors.pageId, syncCursors.syncType],
        set: {
          cursor: null,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          lastSuccessAt: now,
          lastError: null,
          updatedAt: now,
        },
      });
  }
}
