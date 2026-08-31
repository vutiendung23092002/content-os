import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptToken } from "./token-crypto";
import { TokenKeyring } from "./token-keyring";

describe("TokenKeyring", () => {
  const oldKey = randomBytes(32).toString("base64");
  const currentKey = randomBytes(32).toString("base64");
  const keyring = new TokenKeyring({
    currentVersion: 2,
    currentKey,
    previousKeys: { 1: oldKey },
  });

  it("resolves the exact stored key version", () => {
    const oldCredential = encryptToken("old-page-token", oldKey, 1);
    const currentCredential = encryptToken("current-page-token", currentKey, 2);

    expect(keyring.decrypt(oldCredential)).toBe("old-page-token");
    expect(keyring.decrypt(currentCredential)).toBe("current-page-token");
    expect(keyring.encrypt("new-page-token").keyVersion).toBe(2);
  });

  it("fails clearly for an unknown key version without fallback", () => {
    const credential = encryptToken("page-token", currentKey, 99);

    expect(() => keyring.decrypt(credential)).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_TOKEN_KEY_VERSION" }),
    );
  });
});
