import { and, asc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { pages } from "@/db/schema";

export type PageRecord = typeof pages.$inferSelect;

export type ManagedPageInput = {
  externalPageId: string;
  name: string;
  avatarUrl?: string;
  category?: string;
  timezone?: string;
  remoteMetadata?: Record<string, unknown>;
};

export class PageRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async upsertManagedPage(input: ManagedPageInput): Promise<PageRecord> {
    const now = new Date();
    const [record] = await this.database
      .insert(pages)
      .values({
        externalPageId: input.externalPageId,
        name: input.name,
        avatarUrl: input.avatarUrl,
        category: input.category,
        timezone: input.timezone,
        connectionStatus: "active",
        isActive: true,
        lastSyncedAt: now,
        remoteMetadata: input.remoteMetadata ?? {},
      })
      .onConflictDoUpdate({
        target: pages.externalPageId,
        set: {
          name: input.name,
          avatarUrl: input.avatarUrl,
          category: input.category,
          timezone: input.timezone,
          isActive: true,
          connectionStatus: "active",
          lastSyncedAt: now,
          remoteMetadata: input.remoteMetadata ?? {},
          updatedAt: now,
        },
      })
      .returning();

    if (!record) {
      throw new Error("Failed to upsert managed Page");
    }

    return record;
  }

  async findById(id: string): Promise<PageRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);
    return record;
  }

  async findByExternalId(
    externalPageId: string,
  ): Promise<PageRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(pages)
      .where(eq(pages.externalPageId, externalPageId))
      .limit(1);
    return record;
  }

  async listActive(): Promise<PageRecord[]> {
    return this.database
      .select()
      .from(pages)
      .where(eq(pages.isActive, true))
      .orderBy(asc(pages.name));
  }

  async deactivate(id: string): Promise<PageRecord | undefined> {
    const [record] = await this.database
      .update(pages)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(pages.id, id), eq(pages.isActive, true)))
      .returning();
    return record;
  }
}
