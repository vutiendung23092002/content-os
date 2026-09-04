import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptToken } from "@/lib/crypto/token-crypto";
import { TokenKeyring } from "@/lib/crypto/token-keyring";
import type { SelectedPageCredential } from "@/db/repositories/page-credential-repository";
import {
  createMetaClientFromCredential,
  toOperationCredentialProvenance,
} from "./page-credential";

describe("Page credential Meta adapter", () => {
  it("decrypts the stored version only at Meta client construction", () => {
    const oldKey = randomBytes(32).toString("base64");
    const currentKey = randomBytes(32).toString("base64");
    const keyring = new TokenKeyring({
      currentVersion: 2,
      currentKey,
      previousKeys: { 1: oldKey },
    });
    const credential = encryptToken("page-access-token", oldKey, 1);
    const client = { getPublishedPosts: vi.fn() };
    const createClient = vi.fn().mockReturnValue(client);

    expect(
      createMetaClientFromCredential(credential, {
        keyring,
        createClient,
      }),
    ).toBe(client);
    expect(createClient).toHaveBeenCalledWith("page-access-token");
    expect(JSON.stringify(credential)).not.toContain("page-access-token");
  });

  it("creates safe operation provenance without copying credential material", () => {
    const encrypted = encryptToken(
      "page-access-token",
      randomBytes(32).toString("base64"),
      2,
    );
    const credential: SelectedPageCredential = {
      id: "11111111-1111-4111-8111-111111111111",
      pageId: "22222222-2222-4222-8222-222222222222",
      facebookConnectionId: "33333333-3333-4333-8333-333333333333",
      accessTokenCiphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      tokenFingerprint: encrypted.fingerprint,
      expiresAt: null,
      lastValidatedAt: new Date(),
      revokedAt: null,
      providerMetadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      credentialSource: "user_connected",
    };

    const provenance = toOperationCredentialProvenance(
      credential,
      "44444444-4444-4444-8444-444444444444",
    );

    expect(provenance).toEqual({
      credentialSource: "user_connected",
      facebookConnectionId: credential.facebookConnectionId,
      pageCredentialId: credential.id,
      actorUserId: "44444444-4444-4444-8444-444444444444",
    });
    expect(JSON.stringify(provenance)).not.toMatch(
      /token|ciphertext|nonce|authTag|fingerprint/i,
    );
  });
});
