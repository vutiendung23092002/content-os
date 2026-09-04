import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PageCredentialRecord } from "@/db/repositories/page-credential-repository";
import type { FacebookConnectionRecord } from "@/db/repositories/facebook-connection-repository";
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
    facebookConnectionId: overrides.facebookConnectionId ?? null,
    accessTokenCiphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    tokenFingerprint: encrypted.fingerprint,
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    lastValidatedAt: new Date("2026-08-30T00:00:00.000Z"),
    revokedAt: null,
    providerMetadata: overrides.providerMetadata ?? {},
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

function userConnection(token: string): FacebookConnectionRecord {
  const encrypted = encryptToken(token, oldKey, 1);
  return {
    id: "connection-1",
    appUserId: "11111111-1111-4111-8111-111111111111",
    externalUserId: "facebook-user",
    metaAppId: "app-b",
    connectionType: "user_connected",
    status: "active",
    accountName: "Facebook User",
    accountAvatarUrl: null,
    grantedScopes: ["pages_show_list"],
    tokenExpiresAt: null,
    dataAccessExpiresAt: null,
    userTokenCiphertext: encrypted.ciphertext,
    userTokenNonce: encrypted.nonce,
    userTokenAuthTag: encrypted.authTag,
    userTokenKeyVersion: encrypted.keyVersion,
    userTokenFingerprint: encrypted.fingerprint,
    lastValidatedAt: new Date("2026-08-30T00:00:00.000Z"),
    disconnectedAt: null,
    providerMetadata: { preserved: true },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
  };
}

function cloneConnection(
  record: FacebookConnectionRecord,
): FacebookConnectionRecord {
  return {
    ...record,
    userTokenCiphertext: record.userTokenCiphertext
      ? Buffer.from(record.userTokenCiphertext)
      : null,
    userTokenNonce: record.userTokenNonce
      ? Buffer.from(record.userTokenNonce)
      : null,
    userTokenAuthTag: record.userTokenAuthTag
      ? Buffer.from(record.userTokenAuthTag)
      : null,
  };
}

function createTransactionalStore(
  initial: PageCredentialRecord[],
  initialConnections: FacebookConnectionRecord[] = [],
) {
  let committed = initial.map(cloneRecord);
  let committedConnections = initialConnections.map(cloneConnection);

  const transaction = async <Result>(
    work: (store: PageCredentialRotationStore) => Promise<Result>,
  ): Promise<Result> => {
    const staged = committed.map(cloneRecord);
    const stagedConnections = committedConnections.map(cloneConnection);
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
      async listUserConnectedByKeyVersion(version) {
        return stagedConnections.filter(
          (item) => item.userTokenKeyVersion === version,
        );
      },
      async replaceUserTokenEncryption(input) {
        const item = stagedConnections.find(
          (candidate) =>
            candidate.id === input.id &&
            candidate.userTokenKeyVersion === input.expectedKeyVersion &&
            candidate.userTokenFingerprint === input.expectedFingerprint,
        );
        if (!item) return false;
        item.userTokenCiphertext = input.encrypted.ciphertext;
        item.userTokenNonce = input.encrypted.nonce;
        item.userTokenAuthTag = input.encrypted.authTag;
        item.userTokenKeyVersion = input.encrypted.keyVersion;
        item.userTokenFingerprint = input.encrypted.fingerprint;
        item.updatedAt = new Date();
        return true;
      },
    };
    const result = await work(store);
    committed = staged;
    committedConnections = stagedConnections;
    return result;
  };

  return {
    transaction,
    records: () => committed,
    connections: () => committedConnections,
  };
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
      userConnectionCount: 0,
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

  it("rotates App B user tokens atomically while preserving connection metadata", async () => {
    const before = userConnection("user-access-token");
    const database = createTransactionalStore([], [before]);
    const service = new PageCredentialRotationService(
      keyring(),
      database.transaction,
    );

    await expect(service.rotate({ fromVersion: 1 })).resolves.toMatchObject({
      credentialCount: 0,
      userConnectionCount: 1,
    });
    const after = database.connections()[0]!;
    expect(after.userTokenKeyVersion).toBe(2);
    expect(
      keyring().decrypt({
        ciphertext: after.userTokenCiphertext!,
        nonce: after.userTokenNonce!,
        authTag: after.userTokenAuthTag!,
        keyVersion: after.userTokenKeyVersion!,
        fingerprint: after.userTokenFingerprint!,
      }),
    ).toBe("user-access-token");
    expect(after).toMatchObject({
      id: before.id,
      appUserId: before.appUserId,
      metaAppId: before.metaAppId,
      providerMetadata: { preserved: true },
      tokenExpiresAt: before.tokenExpiresAt,
      dataAccessExpiresAt: before.dataAccessExpiresAt,
      userTokenFingerprint: before.userTokenFingerprint,
    });
  });

  it("rolls back Page and user-token writes when an App B token cannot decrypt", async () => {
    const page = credential("page-1", "page-token");
    const connection = userConnection("user-access-token");
    connection.userTokenAuthTag = Buffer.from(connection.userTokenAuthTag!);
    connection.userTokenAuthTag[0] = (connection.userTokenAuthTag[0] ?? 0) ^ 1;
    const database = createTransactionalStore([page], [connection]);
    const service = new PageCredentialRotationService(
      keyring(),
      database.transaction,
    );

    await expect(service.rotate({ fromVersion: 1 })).rejects.toMatchObject({
      code: "TOKEN_DECRYPTION_FAILED",
    });
    expect(database.records()[0]?.keyVersion).toBe(1);
    expect(database.connections()[0]?.userTokenKeyVersion).toBe(1);
  });
});
