import { eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { pageCredentials } from "@/db/schema";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";

export type PageCredentialRecord = typeof pageCredentials.$inferSelect;

export class PageCredentialRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async upsert(
    pageId: string,
    encrypted: EncryptedToken,
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
}
