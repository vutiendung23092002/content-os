import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { AppError } from "@/lib/errors/app-error";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

export type EncryptedToken = {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
  fingerprint: string;
};

function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");

  if (key.length !== KEY_BYTES) {
    throw new AppError({
      code: "INVALID_ENCRYPTION_KEY",
      message: "TOKEN_ENCRYPTION_KEY phải là khóa base64 32 byte.",
      status: 500,
    });
  }

  return key;
}

export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function encryptToken(
  token: string,
  base64Key: string,
  keyVersion = 1,
): EncryptedToken {
  const key = decodeKey(base64Key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    keyVersion,
    fingerprint: tokenFingerprint(token),
  };
}

export function decryptToken(
  encrypted: EncryptedToken,
  base64Key: string,
): string {
  try {
    const key = decodeKey(base64Key);
    const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce);
    decipher.setAuthTag(encrypted.authTag);

    return Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError({
      code: "TOKEN_DECRYPTION_FAILED",
      message: "Không thể giải mã Page credential.",
      status: 500,
      cause: error,
    });
  }
}
