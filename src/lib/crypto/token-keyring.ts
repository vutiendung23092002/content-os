import "server-only";

import { z } from "zod";
import {
  decryptToken,
  encryptToken,
  type EncryptedToken,
} from "./token-crypto";
import { getServerEnv, requireServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors/app-error";

const keyVersionSchema = z.coerce.number().int().positive();
const previousKeysSchema = z.record(z.string(), z.string().trim().min(1));

export type TokenKeyringConfig = {
  currentVersion: number;
  currentKey: string;
  previousKeys?: Readonly<Record<number, string>>;
};

export class TokenKeyring {
  readonly currentVersion: number;
  private readonly keys: ReadonlyMap<number, string>;

  constructor(config: TokenKeyringConfig) {
    this.currentVersion = keyVersionSchema.parse(config.currentVersion);
    const keys = new Map<number, string>();

    for (const [rawVersion, key] of Object.entries(config.previousKeys ?? {})) {
      const version = keyVersionSchema.parse(rawVersion);
      if (String(version) !== rawVersion) {
        throw new AppError({
          code: "INVALID_TOKEN_KEYRING",
          message: `Phiên bản khóa Page token không hợp lệ: ${rawVersion}.`,
          status: 500,
        });
      }
      keys.set(version, key);
    }

    if (keys.has(this.currentVersion)) {
      throw new AppError({
        code: "DUPLICATE_TOKEN_KEY_VERSION",
        message: `Phiên bản khóa hiện tại ${this.currentVersion} không được khai báo trong previous keys.`,
        status: 500,
      });
    }
    keys.set(this.currentVersion, config.currentKey);
    this.keys = keys;
  }

  encrypt(token: string): EncryptedToken {
    return encryptToken(
      token,
      this.requireKey(this.currentVersion),
      this.currentVersion,
    );
  }

  decrypt(encrypted: EncryptedToken): string {
    return decryptToken(encrypted, this.requireKey(encrypted.keyVersion));
  }

  reencrypt(encrypted: EncryptedToken): EncryptedToken {
    return this.encrypt(this.decrypt(encrypted));
  }

  hasVersion(version: number): boolean {
    return this.keys.has(version);
  }

  private requireKey(version: number): string {
    const key = this.keys.get(version);
    if (!key) {
      throw new AppError({
        code: "UNKNOWN_TOKEN_KEY_VERSION",
        message: `Không có khóa giải mã cho Page credential version ${version}.`,
        status: 500,
      });
    }
    return key;
  }
}

function parsePreviousKeys(value: string | undefined): Record<number, string> {
  if (!value) return {};

  try {
    const parsed = previousKeysSchema.parse(JSON.parse(value));
    return Object.fromEntries(
      Object.entries(parsed).map(([version, key]) => [
        keyVersionSchema.parse(version),
        key,
      ]),
    );
  } catch (error) {
    throw new AppError({
      code: "INVALID_TOKEN_KEYRING",
      message:
        "TOKEN_ENCRYPTION_PREVIOUS_KEYS phải là JSON map version sang khóa base64.",
      status: 500,
      cause: error,
    });
  }
}

export function getTokenKeyring(): TokenKeyring {
  const env = getServerEnv();
  return new TokenKeyring({
    currentVersion: env.TOKEN_ENCRYPTION_KEY_VERSION ?? 1,
    currentKey: requireServerEnv("TOKEN_ENCRYPTION_KEY"),
    previousKeys: parsePreviousKeys(env.TOKEN_ENCRYPTION_PREVIOUS_KEYS),
  });
}
