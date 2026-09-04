import { describe, expect, it } from "vitest";
import type { PageCredentialRecord } from "./page-credential-repository";
import { __testing } from "./page-credential-repository";

function credential(
  id: string,
  facebookConnectionId: string | null,
): PageCredentialRecord {
  return {
    id,
    pageId: "11111111-1111-4111-8111-111111111111",
    facebookConnectionId,
    accessTokenCiphertext: Buffer.from(id),
    nonce: Buffer.alloc(12),
    authTag: Buffer.alloc(16),
    keyVersion: 1,
    tokenFingerprint: `${id}-fingerprint`,
    expiresAt: null,
    lastValidatedAt: null,
    revokedAt: null,
    providerMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const appA = {
  credential: credential("app-a", "connection-app-a"),
  connectionType: "admin_managed" as const,
  connectionUserId: null,
};
const legacyAppA = {
  credential: credential("legacy-app-a", null),
  connectionType: null,
  connectionUserId: null,
};
const appBUserA = {
  credential: credential("app-b-user-a", "connection-user-a"),
  connectionType: "user_connected" as const,
  connectionUserId: "user-a",
};
const appBUserB = {
  credential: credential("app-b-user-b", "connection-user-b"),
  connectionType: "user_connected" as const,
  connectionUserId: "user-b",
};

describe("Page credential selection policy", () => {
  it("returns App A to actors and system when it is the only source", () => {
    expect(__testing.selectActorCredential([appA], "user-a")?.id).toBe("app-a");
    expect(__testing.selectAdminManagedCredential([appA])?.id).toBe("app-a");
  });

  it("returns only the owner credential when App B is the only source", () => {
    expect(__testing.selectActorCredential([appBUserA], "user-a")?.id).toBe(
      "app-b-user-a",
    );
    expect(
      __testing.selectActorCredential([appBUserA], "user-b"),
    ).toBeUndefined();
    expect(__testing.selectAdminManagedCredential([appBUserA])).toBeUndefined();
  });

  it("keeps App B credentials isolated between actors and returns none to system", () => {
    const candidates = [appBUserA, appBUserB];
    expect(__testing.selectActorCredential(candidates, "user-a")?.id).toBe(
      "app-b-user-a",
    );
    expect(__testing.selectActorCredential(candidates, "user-b")?.id).toBe(
      "app-b-user-b",
    );
    expect(__testing.selectAdminManagedCredential(candidates)).toBeUndefined();
  });

  it("prefers own App B and otherwise falls back to connection-backed App A", () => {
    const candidates = [appBUserA, appBUserB, appA];
    expect(__testing.selectActorCredential(candidates, "user-a")?.id).toBe(
      "app-b-user-a",
    );
    expect(__testing.selectActorCredential(candidates, "user-c")?.id).toBe(
      "app-a",
    );
    expect(__testing.selectAdminManagedCredential(candidates)?.id).toBe(
      "app-a",
    );
  });

  it("supports a truly legacy App A credential without exposing App B to system", () => {
    const candidates = [appBUserA, legacyAppA];
    expect(__testing.selectActorCredential(candidates, "user-b")?.id).toBe(
      "legacy-app-a",
    );
    expect(__testing.selectAdminManagedCredential(candidates)?.id).toBe(
      "legacy-app-a",
    );
  });
});
