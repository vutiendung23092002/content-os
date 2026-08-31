import "server-only";

import { runInTransaction } from "@/db/client";
import {
  PageCredentialRepository,
  type PageCredentialRecord,
} from "@/db/repositories/page-credential-repository";
import { getTokenKeyring, type TokenKeyring } from "@/lib/crypto/token-keyring";
import { AppError } from "@/lib/errors/app-error";
import { toStoredPageToken } from "./page-credential";

export type PageCredentialRotationStore = {
  listByKeyVersion(keyVersion: number): Promise<PageCredentialRecord[]>;
  replaceEncryption(input: {
    pageId: string;
    expectedKeyVersion: number;
    expectedFingerprint: string;
    encrypted: ReturnType<TokenKeyring["encrypt"]>;
  }): Promise<boolean>;
};

export type PageCredentialRotationResult = {
  dryRun: boolean;
  fromVersion: number;
  toVersion: number;
  credentialCount: number;
};

type RunRotationTransaction = <Result>(
  work: (store: PageCredentialRotationStore) => Promise<Result>,
) => Promise<Result>;

function defaultTransaction<Result>(
  work: (store: PageCredentialRotationStore) => Promise<Result>,
): Promise<Result> {
  return runInTransaction((transaction) =>
    work(new PageCredentialRepository(transaction)),
  );
}

export class PageCredentialRotationService {
  constructor(
    private readonly keyring: TokenKeyring = getTokenKeyring(),
    private readonly transaction: RunRotationTransaction = defaultTransaction,
  ) {}

  async rotate(input: {
    fromVersion: number;
    dryRun?: boolean;
  }): Promise<PageCredentialRotationResult> {
    if (!Number.isInteger(input.fromVersion) || input.fromVersion <= 0) {
      throw new AppError({
        code: "INVALID_TOKEN_KEY_VERSION",
        message: "Phiên bản khóa nguồn phải là số nguyên dương.",
        status: 400,
      });
    }
    if (input.fromVersion === this.keyring.currentVersion) {
      throw new AppError({
        code: "TOKEN_ROTATION_VERSION_UNCHANGED",
        message: "Khóa nguồn và khóa đích phải có version khác nhau.",
        status: 409,
      });
    }
    if (!this.keyring.hasVersion(input.fromVersion)) {
      throw new AppError({
        code: "UNKNOWN_TOKEN_KEY_VERSION",
        message: `Không có khóa giải mã cho Page credential version ${input.fromVersion}.`,
        status: 500,
      });
    }

    const dryRun = input.dryRun ?? false;
    return this.transaction(async (store) => {
      const credentials = await store.listByKeyVersion(input.fromVersion);

      for (const credential of credentials) {
        const encrypted = this.keyring.reencrypt(toStoredPageToken(credential));

        if (encrypted.fingerprint !== credential.tokenFingerprint) {
          throw new AppError({
            code: "TOKEN_FINGERPRINT_MISMATCH",
            message: "Page credential fingerprint không khớp; đã hủy rotation.",
            status: 500,
          });
        }

        if (!dryRun) {
          const updated = await store.replaceEncryption({
            pageId: credential.pageId,
            expectedKeyVersion: input.fromVersion,
            expectedFingerprint: credential.tokenFingerprint,
            encrypted,
          });
          if (!updated) {
            throw new AppError({
              code: "PAGE_CREDENTIAL_ROTATION_CONFLICT",
              message:
                "Page credential đã thay đổi trong lúc rotation; đã hủy toàn bộ batch.",
              status: 409,
            });
          }
        }
      }

      return {
        dryRun,
        fromVersion: input.fromVersion,
        toVersion: this.keyring.currentVersion,
        credentialCount: credentials.length,
      };
    });
  }
}
