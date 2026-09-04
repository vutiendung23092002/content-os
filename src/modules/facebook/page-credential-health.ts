import "server-only";

import type { DatabaseExecutor } from "@/db/client";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import type { PageCredentialIncidentStatus } from "./credential-incident";

export type PageCredentialHealthContext = {
  status: PageCredentialIncidentStatus;
  errorCode: string;
  detectedAt?: Date;
  operationId?: string;
  credentialExpiresAt?: Date;
  excludingCredentialId?: string;
  excludingConnectionId?: string;
  excludingLegacy?: boolean;
};

export async function reconcilePageCredentialHealth(
  database: DatabaseExecutor,
  pageId: string,
  context: PageCredentialHealthContext,
): Promise<"usable" | "locked"> {
  const detectedAt = context.detectedAt ?? new Date();
  const usable = await new PageCredentialRepository(
    database,
  ).hasUsableCredentialForPage({
    pageId,
    excludingCredentialId: context.excludingCredentialId,
    excludingConnectionId: context.excludingConnectionId,
    excludingLegacy: context.excludingLegacy,
    now: detectedAt,
  });
  if (usable) return "usable";

  await new PageRepository(database).lockForCredentialIncident({
    pageId,
    status: context.status,
    errorCode: context.errorCode,
    operationId: context.operationId,
    detectedAt,
    credentialExpiresAt: context.credentialExpiresAt,
  });
  return "locked";
}

export async function reconcileConnectionPageCredentialHealth(
  database: DatabaseExecutor,
  pageIds: string[],
  context: Omit<
    PageCredentialHealthContext,
    "excludingCredentialId" | "excludingConnectionId" | "excludingLegacy"
  >,
): Promise<void> {
  for (const pageId of new Set(pageIds)) {
    await reconcilePageCredentialHealth(database, pageId, context);
  }
}
