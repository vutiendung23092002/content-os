import { and, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { pageCredentials } from "@/db/schema";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";

export type PageCredentialRecord = typeof pageCredentials.$inferSelect;

export class PageCredentialRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async upsert(
    pageId: string,
    encrypted: EncryptedToken,
    expiresAt?: Date,
  ): Promise<PageCredentialRecord> {
    const now = new Date();
    const [record] = await this.database
      .insert(pageCredentials)
      .values({
        pageId,
        accessTokenCiphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        tokenFingerprint: encrypted.fingerprint,
        expiresAt,
        lastValidatedAt: now,
      })
      .onConflictDoUpdate({
        target: pageCredentials.pageId,
        set: {
          accessTokenCiphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          tokenFingerprint: encrypted.fingerprint,
          expiresAt,
          lastValidatedAt: now,
          revokedAt: null,
          updatedAt: now,
        },
      })
      .returning();

    if (!record) {
      throw new Error("Failed to upsert Page credential");
    }

    return record;
  }

  async findByPageId(
    pageId: string,
  ): Promise<PageCredentialRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(pageCredentials)
      .where(eq(pageCredentials.pageId, pageId))
      .limit(1);
    return record;
  }

  async listByKeyVersion(keyVersion: number): Promise<PageCredentialRecord[]> {
    return this.database
      .select()
      .from(pageCredentials)
      .where(eq(pageCredentials.keyVersion, keyVersion));
  }

  async replaceEncryption(input: {
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
          eq(pageCredentials.pageId, input.pageId),
          eq(pageCredentials.keyVersion, input.expectedKeyVersion),
          eq(pageCredentials.tokenFingerprint, input.expectedFingerprint),
        ),
      )
      .returning({ pageId: pageCredentials.pageId });

    return Boolean(updated);
  }

  async markRevoked(pageId: string, revokedAt = new Date()): Promise<boolean> {
    const [updated] = await this.database
      .update(pageCredentials)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(eq(pageCredentials.pageId, pageId))
      .returning({ pageId: pageCredentials.pageId });
    return Boolean(updated);
  }
}
