import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptToken } from "@/lib/crypto/token-crypto";
import { TokenKeyring } from "@/lib/crypto/token-keyring";
import { createMetaClientFromCredential } from "./page-credential";

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
});
