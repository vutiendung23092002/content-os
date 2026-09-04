import "server-only";

import type { DatabaseExecutor } from "@/db/client";
import { FacebookConnectionRepository } from "@/db/repositories/facebook-connection-repository";
import {
  PageCredentialRepository,
  type PageCredentialRecord,
} from "@/db/repositories/page-credential-repository";
import type { PageRecord } from "@/db/repositories/page-repository";
import { AppError } from "@/lib/errors/app-error";
import { reconcilePageCredentialHealth } from "./page-credential-health";

export type PageCredentialIncidentStatus =
  "expired" | "revoked" | "permission_missing" | "error";

export function isPageCredentialExpired(
  credential: Pick<PageCredentialRecord, "expiresAt">,
  now = new Date(),
): boolean {
  return Boolean(credential.expiresAt && credential.expiresAt <= now);
}

export function pageCredentialExpiredError(): AppError {
  return new AppError({
    code: "PAGE_CREDENTIAL_EXPIRED",
    message: "Page credential đã hết hạn và cần được xác thực lại.",
    status: 409,
  });
}

export function assertPageReadyForMutation(
  page: Pick<PageRecord, "isActive" | "connectionStatus"> | undefined,
  inactiveMessage: string,
): asserts page is Pick<PageRecord, "isActive" | "connectionStatus"> {
  if (
    page?.isActive &&
    ["expired", "revoked", "permission_missing", "error"].includes(
      page.connectionStatus,
    )
  ) {
    throw new AppError({
      code: "PAGE_CREDENTIAL_MUTATION_LOCKED",
      message:
        "Page đang bị khóa thao tác Facebook do credential lỗi, hết hạn, bị thu hồi hoặc thiếu quyền.",
      status: 409,
    });
  }
  if (!page || !page.isActive || page.connectionStatus !== "active") {
    throw new AppError({
      code: "PAGE_NOT_ACTIVE",
      message: inactiveMessage,
      status: 409,
    });
  }
}

export function getPageCredentialIncidentStatus(
  error: unknown,
): PageCredentialIncidentStatus | null {
  if (!(error instanceof AppError) || error.retryable) return null;
  if (error.code === "FACEBOOK_TOKEN_INVALID") return "revoked";
  if (error.code === "FACEBOOK_PERMISSION_DENIED") {
    return "permission_missing";
  }
  if (
    error.code === "TOKEN_DECRYPTION_FAILED" ||
    error.code === "UNKNOWN_TOKEN_KEY_VERSION"
  ) {
    return "error";
  }
  return null;
}

export async function recordPageCredentialIncident(
  database: DatabaseExecutor,
  input: {
    pageId: string;
    status: PageCredentialIncidentStatus;
    errorCode: string;
    operationId?: string;
    detectedAt?: Date;
    credentialExpiresAt?: Date;
    credentialId?: string;
    facebookConnectionId?: string | null;
  },
): Promise<void> {
  const detectedAt = input.detectedAt ?? new Date();
  const credentials = new PageCredentialRepository(database);
  if (input.facebookConnectionId) {
    await new FacebookConnectionRepository(database).markStatus(
      input.facebookConnectionId,
      input.status,
    );
    if (input.status === "revoked" && input.credentialId) {
      await credentials.markRevokedById(input.credentialId, detectedAt);
    }
  } else if (input.status === "revoked") {
    await credentials.markLegacyRevoked(input.pageId, detectedAt);
  }

  await reconcilePageCredentialHealth(database, input.pageId, {
    status: input.status,
    errorCode: input.errorCode,
    operationId: input.operationId,
    detectedAt,
    credentialExpiresAt: input.credentialExpiresAt,
    excludingCredentialId: input.credentialId,
    excludingConnectionId: input.facebookConnectionId ?? undefined,
    excludingLegacy:
      input.facebookConnectionId === null ||
      (!input.credentialId && input.facebookConnectionId === undefined),
  });
}

export function recordExpiredPageCredential(
  database: DatabaseExecutor,
  input: {
    pageId: string;
    expiresAt: Date;
    detectedAt?: Date;
    credentialId?: string;
    facebookConnectionId?: string | null;
  },
): Promise<void> {
  return recordPageCredentialIncident(database, {
    pageId: input.pageId,
    status: "expired",
    errorCode: "PAGE_CREDENTIAL_EXPIRED",
    detectedAt: input.detectedAt,
    credentialExpiresAt: input.expiresAt,
    credentialId: input.credentialId,
    facebookConnectionId: input.facebookConnectionId,
  });
}
