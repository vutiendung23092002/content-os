import "server-only";

import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { facebookConnection, pageCredentials } from "@/db/schema";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";

export type PageCredentialRecord = typeof pageCredentials.$inferSelect;
export type FacebookCredentialSource =
  "admin_managed" | "user_connected" | "legacy_admin";
export type SelectedPageCredential = PageCredentialRecord & {
  credentialSource: FacebookCredentialSource;
};
type CredentialCandidate = {
  credential: PageCredentialRecord;
  connectionType: "admin_managed" | "user_connected" | null;
  connectionUserId: string | null;
};

function selectedCredential(
  candidate: CredentialCandidate | undefined,
): SelectedPageCredential | undefined {
  if (!candidate) return undefined;
  return {
    ...candidate.credential,
    credentialSource:
      candidate.connectionType ??
      (candidate.credential.facebookConnectionId === null
        ? "legacy_admin"
        : "user_connected"),
  };
}

function selectAdminManagedCredential(candidates: CredentialCandidate[]) {
  return selectedCredential(
    candidates.find(
      (candidate) => candidate.connectionType === "admin_managed",
    ) ??
      candidates.find(
        (candidate) => candidate.credential.facebookConnectionId === null,
      ),
  );
}

function selectActorCredential(
  candidates: CredentialCandidate[],
  appUserId: string,
) {
  return (
    selectedCredential(
      candidates.find(
        (candidate) =>
          candidate.connectionType === "user_connected" &&
          candidate.connectionUserId === appUserId,
      ),
    ) ?? selectAdminManagedCredential(candidates)
  );
}

function uniquePageIds(records: Array<{ pageId: string }>): string[] {
  return [...new Set(records.map((record) => record.pageId))];
}

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

  async findAdminManagedForPage(
    pageId: string,
  ): Promise<SelectedPageCredential | undefined> {
    return selectAdminManagedCredential(
      await this.listAvailableCredentials(pageId),
    );
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

  async findForActor(
    pageId: string,
    appUserId: string,
  ): Promise<SelectedPageCredential | undefined> {
    return selectActorCredential(
      await this.listAvailableCredentials(pageId),
      appUserId,
    );
  }

  async findExactUsable(input: {
    pageId: string;
    credentialId: string;
    facebookConnectionId: string | null;
  }): Promise<PageCredentialRecord | undefined> {
    const candidates = await this.listAvailableCredentials(input.pageId);
    return candidates.find(
      (candidate) =>
        candidate.credential.id === input.credentialId &&
        candidate.credential.facebookConnectionId ===
          input.facebookConnectionId,
    )?.credential;
  }

  async listPageIdsForConnection(
    facebookConnectionId: string,
  ): Promise<string[]> {
    return uniquePageIds(
      await this.database
        .select({ pageId: pageCredentials.pageId })
        .from(pageCredentials)
        .where(eq(pageCredentials.facebookConnectionId, facebookConnectionId)),
    );
  }

  async hasUsableCredentialForPage(input: {
    pageId: string;
    excludingCredentialId?: string;
    excludingConnectionId?: string;
    excludingLegacy?: boolean;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    const candidates = await this.listAvailableCredentials(input.pageId);
    return candidates.some(({ credential }) => {
      if (
        credential.id === input.excludingCredentialId ||
        credential.facebookConnectionId === input.excludingConnectionId ||
        (input.excludingLegacy && credential.facebookConnectionId === null)
      ) {
        return false;
      }
      return !credential.expiresAt || credential.expiresAt > now;
    });
  }

  private async listAvailableCredentials(
    pageId: string,
  ): Promise<CredentialCandidate[]> {
    return this.database
      .select({
        credential: pageCredentials,
        connectionType: facebookConnection.connectionType,
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

  async markLegacyRevoked(
    pageId: string,
    revokedAt = new Date(),
  ): Promise<boolean> {
    const updated = await this.database
      .update(pageCredentials)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(
        and(
          eq(pageCredentials.pageId, pageId),
          isNull(pageCredentials.facebookConnectionId),
        ),
      )
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

export const __testing = {
  selectActorCredential,
  selectAdminManagedCredential,
};
