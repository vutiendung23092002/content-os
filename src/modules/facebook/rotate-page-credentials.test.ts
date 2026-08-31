import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PageCredentialRecord } from "@/db/repositories/page-credential-repository";
import { encryptToken } from "@/lib/crypto/token-crypto";
import { TokenKeyring } from "@/lib/crypto/token-keyring";
import {
  PageCredentialRotationService,
  type PageCredentialRotationStore,
} from "./rotate-page-credentials";

const oldKey = randomBytes(32).toString("base64");
const newKey = randomBytes(32).toString("base64");

function credential(
  pageId: string,
  token: string,
  overrides: Partial<PageCredentialRecord> = {},
): PageCredentialRecord {
  const encrypted = encryptToken(token, oldKey, 1);
  return {
    id: `credential-${pageId}`,
    pageId,
    accessTokenCiphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    tokenFingerprint: encrypted.fingerprint,
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    lastValidatedAt: new Date("2026-08-30T00:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
    ...overrides,
  };
}

function cloneRecord(record: PageCredentialRecord): PageCredentialRecord {
  return {
    ...record,
    accessTokenCiphertext: Buffer.from(record.accessTokenCiphertext),
    nonce: Buffer.from(record.nonce),
    authTag: Buffer.from(record.authTag),
  };
}

function createTransactionalStore(initial: PageCredentialRecord[]) {
  let committed = initial.map(cloneRecord);

  const transaction = async <Result>(
    work: (store: PageCredentialRotationStore) => Promise<Result>,
  ): Promise<Result> => {
    const staged = committed.map(cloneRecord);
    const store: PageCredentialRotationStore = {
      async listByKeyVersion(version) {
        return staged.filter((item) => item.keyVersion === version);
      },
      async replaceEncryption(input) {
        const item = staged.find(
          (candidate) =>
            candidate.pageId === input.pageId &&
            candidate.keyVersion === input.expectedKeyVersion &&
            candidate.tokenFingerprint === input.expectedFingerprint,
        );
        if (!item) return false;
        item.accessTokenCiphertext = input.encrypted.ciphertext;
        item.nonce = input.encrypted.nonce;
        item.authTag = input.encrypted.authTag;
        item.keyVersion = input.encrypted.keyVersion;
        item.tokenFingerprint = input.encrypted.fingerprint;
        item.updatedAt = new Date();
        return true;
      },
    };
    const result = await work(store);
    committed = staged;
    return result;
  };

  return { transaction, records: () => committed };
}

function keyring() {
  return new TokenKeyring({
    currentVersion: 2,
    currentKey: newKey,
    previousKeys: { 1: oldKey },
  });
}

describe("PageCredentialRotationService", () => {
  it("rotates old credentials atomically and preserves metadata", async () => {
    const before = credential("page-1", "page-token");
    const database = createTransactionalStore([before]);
    const service = new PageCredentialRotationService(
      keyring(),
      database.transaction,
    );

    await expect(service.rotate({ fromVersion: 1 })).resolves.toEqual({
      dryRun: false,
      fromVersion: 1,
      toVersion: 2,
      credentialCount: 1,
    });

    const after = database.records()[0]!;
    expect(after.keyVersion).toBe(2);
    expect(
      keyring().decrypt({
        ciphertext: after.accessTokenCiphertext,
        nonce: after.nonce,
        authTag: after.authTag,
        keyVersion: after.keyVersion,
        fingerprint: after.tokenFingerprint,
      }),
    ).toBe("page-token");
    expect(after).toMatchObject({
      id: before.id,
      pageId: before.pageId,
      expiresAt: before.expiresAt,
      lastValidatedAt: before.lastValidatedAt,
      revokedAt: before.revokedAt,
      createdAt: before.createdAt,
      tokenFingerprint: before.tokenFingerprint,
    });
  });

  it("rolls back the whole batch when one credential cannot be decrypted", async () => {
    const first = credential("page-1", "token-1");
    const second = credential("page-2", "token-2");
    second.authTag = Buffer.from(second.authTag);
    second.authTag[0] = (second.authTag[0] ?? 0) ^ 1;
    const database = createTransactionalStore([first, second]);
    const service = new PageCredentialRotationService(
      keyring(),
      database.transaction,
    );

    await expect(service.rotate({ fromVersion: 1 })).rejects.toMatchObject({
      code: "TOKEN_DECRYPTION_FAILED",
    });
    expect(database.records().map((item) => item.keyVersion)).toEqual([1, 1]);
    expect(database.records()[0]!.accessTokenCiphertext).toEqual(
      first.accessTokenCiphertext,
    );
  });

  it("validates every credential without writing during dry-run", async () => {
    const before = credential("page-1", "page-token");
    const database = createTransactionalStore([before]);
    const service = new PageCredentialRotationService(
      keyring(),
      database.transaction,
    );

    await expect(
      service.rotate({ fromVersion: 1, dryRun: true }),
    ).resolves.toMatchObject({ dryRun: true, credentialCount: 1 });
    expect(database.records()[0]).toEqual(before);
  });
});
