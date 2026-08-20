import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, tokenFingerprint } from "./token-crypto";

describe("Page token encryption", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips a token without storing plaintext", () => {
    const encrypted = encryptToken("page-token-value", key, 2);

    expect(encrypted.ciphertext.toString("utf8")).not.toContain(
      "page-token-value",
    );
    expect(encrypted.keyVersion).toBe(2);
    expect(decryptToken(encrypted, key)).toBe("page-token-value");
  });

  it("detects ciphertext tampering", () => {
    const encrypted = encryptToken("page-token-value", key);
    encrypted.ciphertext[0] = (encrypted.ciphertext[0] ?? 0) ^ 1;

    expect(() => decryptToken(encrypted, key)).toThrow("Không thể giải mã");
  });

  it("creates a stable non-plaintext fingerprint", () => {
    expect(tokenFingerprint("same-token")).toBe(tokenFingerprint("same-token"));
    expect(tokenFingerprint("same-token")).not.toContain("same-token");
  });

  it("rejects a key that is not exactly 32 bytes", () => {
    expect(() =>
      encryptToken("page-token-value", Buffer.from("short").toString("base64")),
    ).toThrow("base64 32 byte");
  });
});
