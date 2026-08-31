import { and, asc, eq, gt } from "drizzle-orm";
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

export type PageCredentialIncidentInput = {
  pageId: string;
  status: "expired" | "revoked" | "permission_missing" | "error";
  errorCode: string;
  operationId?: string;
  detectedAt: Date;
  credentialExpiresAt?: Date;
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

  async listActiveBatch(input: {
    afterId?: string;
    limit: number;
  }): Promise<PageRecord[]> {
    const filters = [eq(pages.isActive, true)];
    if (input.afterId) filters.push(gt(pages.id, input.afterId));
    return this.database
      .select()
      .from(pages)
      .where(and(...filters))
      .orderBy(asc(pages.id))
      .limit(Math.min(Math.max(input.limit, 1), 25));
  }

  async deactivate(id: string): Promise<PageRecord | undefined> {
    const [record] = await this.database
      .update(pages)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(pages.id, id), eq(pages.isActive, true)))
      .returning();
    return record;
  }

  async lockForCredentialIncident(
    input: PageCredentialIncidentInput,
  ): Promise<PageRecord | undefined> {
    const current = await this.findById(input.pageId);
    if (!current) return undefined;

    const [record] = await this.database
      .update(pages)
      .set({
        connectionStatus: input.status,
        remoteMetadata: {
          ...current.remoteMetadata,
          credentialIncident: {
            version: 1,
            status: input.status,
            errorCode: input.errorCode,
            operationId: input.operationId ?? null,
            detectedAt: input.detectedAt.toISOString(),
            credentialExpiresAt:
              input.credentialExpiresAt?.toISOString() ?? null,
          },
        },
        updatedAt: input.detectedAt,
      })
      .where(eq(pages.id, input.pageId))
      .returning();
    return record;
  }
}
