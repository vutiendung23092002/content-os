import "server-only";

import type { DatabaseExecutor } from "@/db/client";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import {
  PageRepository,
  type PageRecord,
} from "@/db/repositories/page-repository";
import { AppError } from "@/lib/errors/app-error";

export type PageCredentialIncidentStatus =
  "revoked" | "permission_missing" | "error";

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
  },
): Promise<void> {
  const detectedAt = input.detectedAt ?? new Date();
  await new PageRepository(database).lockForCredentialIncident({
    pageId: input.pageId,
    status: input.status,
    errorCode: input.errorCode,
    operationId: input.operationId,
    detectedAt,
  });

  if (input.status === "revoked") {
    await new PageCredentialRepository(database).markRevoked(
      input.pageId,
      detectedAt,
    );
  }
}
