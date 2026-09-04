import "server-only";

import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { facebookConnection, pageCredentials } from "@/db/schema";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";

export type PageCredentialRecord = typeof pageCredentials.$inferSelect;

export class PageCredentialRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async upsert(
    pageId: string,
    encrypted: EncryptedToken,
    expiresAt?: Date,
    facebookConnectionId?: string,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PageCredentialRecord> {
    const now = new Date();
    const values = {
      pageId,
      facebookConnectionId,
      accessTokenCiphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      tokenFingerprint: encrypted.fingerprint,
      expiresAt,
      lastValidatedAt: now,
      revokedAt: null,
      providerMetadata: providerMetadata ?? {},
      updatedAt: now,
    };
    const [record] = facebookConnectionId
      ? await this.database
          .insert(pageCredentials)
          .values(values)
          .onConflictDoUpdate({
            target: [
              pageCredentials.pageId,
              pageCredentials.facebookConnectionId,
            ],
            set: values,
          })
          .returning()
      : await this.database
          .insert(pageCredentials)
          .values(values)
          .onConflictDoUpdate({
            target: pageCredentials.pageId,
            targetWhere: isNull(pageCredentials.facebookConnectionId),
            set: values,
          })
          .returning();

    if (!record) throw new Error("Failed to upsert Page credential");
    return record;
  }

  async findByPageId(
    pageId: string,
  ): Promise<PageCredentialRecord | undefined> {
    return this.findForPage(pageId);
  }

  async findByPageAndConnection(
    pageId: string,
    facebookConnectionId: string,
  ): Promise<PageCredentialRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(pageCredentials)
      .where(
        and(
          eq(pageCredentials.pageId, pageId),
          eq(pageCredentials.facebookConnectionId, facebookConnectionId),
        ),
      )
      .limit(1);
    return record;
  }

  async findForPage(pageId: string, appUserId?: string) {
    const rows = await this.database
      .select({
        credential: pageCredentials,
        connectionType: facebookConnection.connectionType,
        connectionStatus: facebookConnection.status,
        connectionUserId: facebookConnection.appUserId,
      })
      .from(pageCredentials)
      .leftJoin(
        facebookConnection,
        eq(pageCredentials.facebookConnectionId, facebookConnection.id),
      )
      .where(
        and(
          eq(pageCredentials.pageId, pageId),
          isNull(pageCredentials.revokedAt),
          or(
            isNull(pageCredentials.facebookConnectionId),
            eq(facebookConnection.status, "active"),
          ),
        ),
      );

    const owned = appUserId
      ? rows.find(
          (row) =>
            row.connectionType === "user_connected" &&
            row.connectionUserId === appUserId,
        )
      : undefined;
    if (owned) return owned.credential;
    const admin = rows.find(
      (row) =>
        row.credential.facebookConnectionId === null ||
        row.connectionType === "admin_managed",
    );
    if (admin) return admin.credential;
    return appUserId ? undefined : rows[0]?.credential;
  }

  async hasActiveUserCredentialOutsideConnection(
    pageId: string,
    excludedConnectionId: string,
  ): Promise<boolean> {
    const [record] = await this.database
      .select({ id: pageCredentials.id })
      .from(pageCredentials)
      .innerJoin(
        facebookConnection,
        eq(pageCredentials.facebookConnectionId, facebookConnection.id),
      )
      .where(
        and(
          eq(pageCredentials.pageId, pageId),
          isNull(pageCredentials.revokedAt),
          isNotNull(pageCredentials.facebookConnectionId),
          ne(pageCredentials.facebookConnectionId, excludedConnectionId),
          eq(facebookConnection.connectionType, "user_connected"),
          eq(facebookConnection.status, "active"),
        ),
      )
      .limit(1);
    return Boolean(record);
  }

  async listByKeyVersion(keyVersion: number): Promise<PageCredentialRecord[]> {
    return this.database
      .select()
      .from(pageCredentials)
      .where(eq(pageCredentials.keyVersion, keyVersion));
  }

  async adoptLegacyCredential(
    pageId: string,
    facebookConnectionId: string,
  ): Promise<void> {
    if (await this.findByPageAndConnection(pageId, facebookConnectionId)) {
      return;
    }
    await this.database
      .update(pageCredentials)
      .set({ facebookConnectionId, updatedAt: new Date() })
      .where(
        and(
          eq(pageCredentials.pageId, pageId),
          isNull(pageCredentials.facebookConnectionId),
        ),
      );
  }

  async replaceEncryption(input: {
    credentialId?: string;
    pageId: string;
    expectedKeyVersion: number;
    expectedFingerprint: string;
    encrypted: EncryptedToken;
  }): Promise<boolean> {
    const [updated] = await this.database
      .update(pageCredentials)
      .set({
        accessTokenCiphertext: input.encrypted.ciphertext,
        nonce: input.encrypted.nonce,
        authTag: input.encrypted.authTag,
        keyVersion: input.encrypted.keyVersion,
        tokenFingerprint: input.encrypted.fingerprint,
        updatedAt: new Date(),
      })
      .where(
        and(
          input.credentialId
            ? eq(pageCredentials.id, input.credentialId)
            : eq(pageCredentials.pageId, input.pageId),
          eq(pageCredentials.keyVersion, input.expectedKeyVersion),
          eq(pageCredentials.tokenFingerprint, input.expectedFingerprint),
        ),
      )
      .returning({ pageId: pageCredentials.pageId });

    return Boolean(updated);
  }

  async markRevoked(pageId: string, revokedAt = new Date()): Promise<boolean> {
    const updated = await this.database
      .update(pageCredentials)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(eq(pageCredentials.pageId, pageId))
      .returning({ pageId: pageCredentials.pageId });
    return updated.length > 0;
  }

  async markRevokedByConnection(
    facebookConnectionId: string,
    revokedAt = new Date(),
  ): Promise<number> {
    const updated = await this.database
      .update(pageCredentials)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(eq(pageCredentials.facebookConnectionId, facebookConnectionId))
      .returning({ id: pageCredentials.id });
    return updated.length;
  }

  async markRevokedById(id: string, revokedAt = new Date()): Promise<boolean> {
    const [updated] = await this.database
      .update(pageCredentials)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(eq(pageCredentials.id, id))
      .returning({ id: pageCredentials.id });
    return Boolean(updated);
  }
}
