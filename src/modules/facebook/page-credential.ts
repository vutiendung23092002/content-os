import "server-only";

import type { FacebookOperationCredentialProvenance } from "@/db/repositories/facebook-operation-repository";
import type {
  PageCredentialRecord,
  SelectedPageCredential,
} from "@/db/repositories/page-credential-repository";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";
import { getTokenKeyring, type TokenKeyring } from "@/lib/crypto/token-keyring";
import { requireServerEnv } from "@/lib/env/server";
import { MetaGraphClient } from "./meta-client";

export type StoredPageToken = EncryptedToken & {
  credentialId?: string;
  facebookConnectionId?: string | null;
};

export function toStoredPageToken(
  credential: Pick<
    PageCredentialRecord,
    | "accessTokenCiphertext"
    | "nonce"
    | "authTag"
    | "keyVersion"
    | "tokenFingerprint"
    | "id"
    | "facebookConnectionId"
  >,
): StoredPageToken {
  return {
    ciphertext: credential.accessTokenCiphertext,
    nonce: credential.nonce,
    authTag: credential.authTag,
    keyVersion: credential.keyVersion,
    fingerprint: credential.tokenFingerprint,
    credentialId: "id" in credential ? (credential.id as string) : undefined,
    facebookConnectionId:
      "facebookConnectionId" in credential
        ? (credential.facebookConnectionId as string | null)
        : undefined,
  };
}

export function toOperationCredentialProvenance(
  credential: SelectedPageCredential,
  actorUserId?: string,
): FacebookOperationCredentialProvenance {
  if (credential.credentialSource === "user_connected" && !actorUserId) {
    throw new Error("User-connected credential requires actor provenance");
  }
  return {
    credentialSource: credential.credentialSource,
    facebookConnectionId: credential.facebookConnectionId,
    pageCredentialId: credential.id,
    actorUserId,
  };
}

/** Plaintext exists only inside this Meta-adapter boundary. */
export function createMetaClientFromCredential(
  credential: StoredPageToken,
  dependencies: {
    keyring?: TokenKeyring;
    createClient?: (accessToken: string) => MetaGraphClient;
  } = {},
): MetaGraphClient {
  const accessToken = (dependencies.keyring ?? getTokenKeyring()).decrypt(
    credential,
  );
  return (
    dependencies.createClient ??
    ((token) =>
      new MetaGraphClient({
        graphVersion: requireServerEnv("FACEBOOK_GRAPH_API_VERSION"),
        accessToken: token,
      }))
  )(accessToken);
}
