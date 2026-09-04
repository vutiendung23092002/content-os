import "server-only";

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { facebookConnection } from "@/db/schema";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";

export type FacebookConnectionRecord = typeof facebookConnection.$inferSelect;

export class FacebookConnectionRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async markActive(input: {
    externalUserId?: string;
    metaAppId?: string;
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
      .where(
        and(
          eq(facebookConnection.connectionType, "admin_managed"),
          isNull(facebookConnection.appUserId),
        ),
      )
      .orderBy(asc(facebookConnection.createdAt))
      .limit(1);
    const now = new Date();

    if (existing) {
      const [updated] = await this.database
        .update(facebookConnection)
        .set({
          externalUserId: input.externalUserId,
          metaAppId: input.metaAppId,
          connectionType: "admin_managed",
          status: "active",
          grantedScopes: input.grantedScopes ?? [],
          tokenExpiresAt: input.tokenExpiresAt,
          providerMetadata: {
            ...existing.providerMetadata,
            ...(input.providerMetadata ?? {}),
          },
          lastValidatedAt: now,
          disconnectedAt: null,
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
        metaAppId: input.metaAppId,
        connectionType: "admin_managed",
        status: "active",
        grantedScopes: input.grantedScopes ?? [],
        tokenExpiresAt: input.tokenExpiresAt,
        providerMetadata: input.providerMetadata ?? {},
        lastValidatedAt: now,
      })
      .returning();
    return created;
  }

  async upsertUserConnected(input: {
    appUserId: string;
    externalUserId: string;
    metaAppId: string;
    accountName: string;
    accountAvatarUrl?: string;
    grantedScopes: string[];
    tokenExpiresAt?: Date;
    dataAccessExpiresAt?: Date;
    encryptedUserToken: EncryptedToken;
    providerMetadata?: Record<string, unknown>;
  }): Promise<FacebookConnectionRecord> {
    const now = new Date();
    const values = {
      appUserId: input.appUserId,
      externalUserId: input.externalUserId,
      metaAppId: input.metaAppId,
      connectionType: "user_connected" as const,
      status: "active" as const,
      accountName: input.accountName,
      accountAvatarUrl: input.accountAvatarUrl,
      grantedScopes: input.grantedScopes,
      tokenExpiresAt: input.tokenExpiresAt,
      dataAccessExpiresAt: input.dataAccessExpiresAt,
      userTokenCiphertext: input.encryptedUserToken.ciphertext,
      userTokenNonce: input.encryptedUserToken.nonce,
      userTokenAuthTag: input.encryptedUserToken.authTag,
      userTokenKeyVersion: input.encryptedUserToken.keyVersion,
      userTokenFingerprint: input.encryptedUserToken.fingerprint,
      lastValidatedAt: now,
      disconnectedAt: null,
      providerMetadata: input.providerMetadata ?? {},
      updatedAt: now,
    };
    const [record] = await this.database
      .insert(facebookConnection)
      .values(values)
      .onConflictDoUpdate({
        target: [
          facebookConnection.appUserId,
          facebookConnection.metaAppId,
          facebookConnection.connectionType,
        ],
        targetWhere: isNotNull(facebookConnection.appUserId),
        set: values,
      })
      .returning();
    if (!record) throw new Error("Failed to upsert Facebook connection");
    return record;
  }

  async findUserConnection(appUserId: string, metaAppId: string) {
    const [record] = await this.database
      .select()
      .from(facebookConnection)
      .where(
        and(
          eq(facebookConnection.appUserId, appUserId),
          eq(facebookConnection.metaAppId, metaAppId),
          eq(facebookConnection.connectionType, "user_connected"),
        ),
      )
      .limit(1);
    return record;
  }

  async findOwnedUserConnection(id: string, appUserId: string) {
    const [record] = await this.database
      .select()
      .from(facebookConnection)
      .where(
        and(
          eq(facebookConnection.id, id),
          eq(facebookConnection.appUserId, appUserId),
          eq(facebookConnection.connectionType, "user_connected"),
        ),
      )
      .limit(1);
    return record;
  }

  async markDisconnected(id: string, appUserId: string): Promise<boolean> {
    const now = new Date();
    const [updated] = await this.database
      .update(facebookConnection)
      .set({ status: "revoked", disconnectedAt: now, updatedAt: now })
      .where(
        and(
          eq(facebookConnection.id, id),
          eq(facebookConnection.appUserId, appUserId),
          eq(facebookConnection.connectionType, "user_connected"),
        ),
      )
      .returning({ id: facebookConnection.id });
    return Boolean(updated);
  }

  async markStatus(
    id: string,
    status: "expired" | "revoked" | "permission_missing" | "error",
    providerMetadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const [updated] = await this.database
      .update(facebookConnection)
      .set({
        status,
        ...(providerMetadata ? { providerMetadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(facebookConnection.id, id))
      .returning({ id: facebookConnection.id });
    return Boolean(updated);
  }

  async listUserConnectedByKeyVersion(
    keyVersion: number,
  ): Promise<FacebookConnectionRecord[]> {
    return this.database
      .select()
      .from(facebookConnection)
      .where(
        and(
          eq(facebookConnection.connectionType, "user_connected"),
          eq(facebookConnection.userTokenKeyVersion, keyVersion),
        ),
      );
  }

  async replaceUserTokenEncryption(input: {
    id: string;
    expectedKeyVersion: number;
    expectedFingerprint: string;
    encrypted: EncryptedToken;
  }): Promise<boolean> {
    const [updated] = await this.database
      .update(facebookConnection)
      .set({
        userTokenCiphertext: input.encrypted.ciphertext,
        userTokenNonce: input.encrypted.nonce,
        userTokenAuthTag: input.encrypted.authTag,
        userTokenKeyVersion: input.encrypted.keyVersion,
        userTokenFingerprint: input.encrypted.fingerprint,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(facebookConnection.id, input.id),
          eq(facebookConnection.connectionType, "user_connected"),
          eq(facebookConnection.userTokenKeyVersion, input.expectedKeyVersion),
          eq(
            facebookConnection.userTokenFingerprint,
            input.expectedFingerprint,
          ),
        ),
      )
      .returning({ id: facebookConnection.id });
    return Boolean(updated);
  }
}
