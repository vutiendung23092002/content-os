import { asc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { facebookConnection } from "@/db/schema";

export class FacebookConnectionRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async markActive(input: {
    externalUserId?: string;
    grantedScopes?: string[];
    tokenExpiresAt?: Date | null;
    providerMetadata?: Record<string, unknown>;
  }) {
    const [existing] = await this.database
      .select({
        id: facebookConnection.id,
        providerMetadata: facebookConnection.providerMetadata,
      })
      .from(facebookConnection)
      .orderBy(asc(facebookConnection.createdAt))
      .limit(1);
    const now = new Date();

    if (existing) {
      const [updated] = await this.database
        .update(facebookConnection)
        .set({
          externalUserId: input.externalUserId,
          status: "active",
          grantedScopes: input.grantedScopes ?? [],
          tokenExpiresAt: input.tokenExpiresAt,
          providerMetadata: {
            ...existing.providerMetadata,
            ...(input.providerMetadata ?? {}),
          },
          lastValidatedAt: now,
          updatedAt: now,
        })
        .where(eq(facebookConnection.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.database
      .insert(facebookConnection)
      .values({
        externalUserId: input.externalUserId,
        status: "active",
        grantedScopes: input.grantedScopes ?? [],
        tokenExpiresAt: input.tokenExpiresAt,
        providerMetadata: input.providerMetadata ?? {},
        lastValidatedAt: now,
      })
      .returning();
    return created;
  }
}
