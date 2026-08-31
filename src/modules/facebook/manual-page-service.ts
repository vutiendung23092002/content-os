import "server-only";
import { z } from "zod";
import { runInTransaction } from "@/db/client";
import { FacebookConnectionRepository } from "@/db/repositories/facebook-connection-repository";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";
import type { TokenKeyring } from "@/lib/crypto/token-keyring";
import { AppError } from "@/lib/errors/app-error";
import {
  MetaGraphClient,
  type MetaPageReadAccess,
  type MetaTokenInspection,
} from "./meta-client";

export const manualPageIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,30}$/, "Page ID phải là một dãy số hợp lệ.");

export type ManualPageCapabilities = {
  readPublishedPosts: boolean;
  readScheduledPosts: boolean;
  managePostsScope: boolean;
  manageEngagementScope: boolean;
  readInsightsScope: boolean;
  manageMetadataScope: boolean;
};

export type VerifiedManualPage = {
  account: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  userToken: MetaTokenInspection;
  page: {
    externalPageId: string;
    name: string;
    avatarUrl?: string;
    category?: string;
  };
  pageToken: MetaTokenInspection;
  pageCredential: EncryptedToken;
  capabilities: ManualPageCapabilities;
};

export type SafeManualPage = {
  account: VerifiedManualPage["account"];
  token: {
    isValid: boolean;
    scopes: string[];
    expiresAt: string | null;
    dataAccessExpiresAt: string | null;
  };
  page: VerifiedManualPage["page"] & {
    localId?: string;
  };
  capabilities: ManualPageCapabilities;
};

export type ManualPageClientFactory = (accessToken: string) => MetaGraphClient;

function unixSecondsToIso(value?: number): string | null {
  return value && value > 0 ? new Date(value * 1000).toISOString() : null;
}

function unixSecondsToDate(value?: number): Date | undefined {
  return value && value > 0 ? new Date(value * 1000) : undefined;
}

function assertUserToken(
  inspection: MetaTokenInspection,
  expectedAppId: string,
  expectedUserId: string,
): void {
  if (
    !inspection.isValid ||
    inspection.appId !== expectedAppId ||
    inspection.userId !== expectedUserId
  ) {
    throw new AppError({
      code: "FACEBOOK_USER_TOKEN_INVALID",
      message:
        "Facebook User Access Token không hợp lệ hoặc không thuộc đúng App.",
      status: 403,
    });
  }
}

function assertPageToken(
  inspection: MetaTokenInspection,
  expectedAppId: string,
  expectedPageId: string,
): void {
  if (
    !inspection.isValid ||
    inspection.appId !== expectedAppId ||
    inspection.type !== "PAGE" ||
    inspection.profileId !== expectedPageId
  ) {
    throw new AppError({
      code: "FACEBOOK_PAGE_TOKEN_INVALID",
      message: "Không lấy được Page Access Token hợp lệ cho Page này.",
      status: 403,
    });
  }
}

function mapCapabilities(
  scopes: string[],
  readAccess: MetaPageReadAccess,
): ManualPageCapabilities {
  const granted = new Set(scopes);

  return {
    readPublishedPosts: readAccess.publishedPosts,
    readScheduledPosts: readAccess.scheduledPosts,
    managePostsScope: granted.has("pages_manage_posts"),
    manageEngagementScope: granted.has("pages_manage_engagement"),
    readInsightsScope: granted.has("read_insights"),
    manageMetadataScope: granted.has("pages_manage_metadata"),
  };
}

export async function verifyManualPage(input: {
  pageId: string;
  graphVersion: string;
  userAccessToken: string;
  appId: string;
  appSecret: string;
  tokenEncryption: Pick<TokenKeyring, "encrypt">;
  clientFactory?: ManualPageClientFactory;
}): Promise<VerifiedManualPage> {
  const pageId = manualPageIdSchema.parse(input.pageId);
  const clientFactory =
    input.clientFactory ??
    ((accessToken: string) =>
      new MetaGraphClient({
        graphVersion: input.graphVersion,
        accessToken,
      }));
  const userClient = clientFactory(input.userAccessToken);
  const [account, userToken] = await Promise.all([
    userClient.getCurrentUser(),
    userClient.inspectCurrentToken({
      appId: input.appId,
      appSecret: input.appSecret,
    }),
  ]);
  assertUserToken(userToken, input.appId, account.id);

  const page = await userClient.getPageCredential(pageId);
  if (page.externalPageId !== pageId) {
    throw new AppError({
      code: "FACEBOOK_PAGE_ID_MISMATCH",
      message: "Facebook trả về Page không khớp với Page ID đã nhập.",
      status: 409,
    });
  }

  const pageClient = clientFactory(page.accessToken);
  const [pageToken, readAccess] = await Promise.all([
    pageClient.inspectCurrentToken({
      appId: input.appId,
      appSecret: input.appSecret,
    }),
    pageClient.probePageReadAccess(pageId),
  ]);
  assertPageToken(pageToken, input.appId, pageId);

  return {
    account,
    userToken,
    page: {
      externalPageId: page.externalPageId,
      name: page.name,
      avatarUrl: page.avatarUrl,
      category: page.category,
    },
    pageToken,
    pageCredential: input.tokenEncryption.encrypt(page.accessToken),
    capabilities: mapCapabilities(pageToken.scopes, readAccess),
  };
}

export function toSafeManualPage(
  verification: VerifiedManualPage,
  localId?: string,
): SafeManualPage {
  return {
    account: verification.account,
    token: {
      isValid: verification.userToken.isValid,
      scopes: verification.userToken.scopes,
      expiresAt: unixSecondsToIso(verification.userToken.expiresAt),
      dataAccessExpiresAt: unixSecondsToIso(
        verification.userToken.dataAccessExpiresAt,
      ),
    },
    page: {
      ...verification.page,
      localId,
    },
    capabilities: verification.capabilities,
  };
}

export async function persistManualPage(input: {
  verification: VerifiedManualPage;
}): Promise<SafeManualPage> {
  const verifiedAt = new Date();

  return runInTransaction(async (transaction) => {
    const pageRepository = new PageRepository(transaction);
    const credentialRepository = new PageCredentialRepository(transaction);
    const connectionRepository = new FacebookConnectionRepository(transaction);
    const page = await pageRepository.upsertManagedPage({
      externalPageId: input.verification.page.externalPageId,
      name: input.verification.page.name,
      avatarUrl: input.verification.page.avatarUrl,
      category: input.verification.page.category,
      remoteMetadata: {
        source: "manual_page_id",
        verifiedAt: verifiedAt.toISOString(),
        ownerFacebookUserId: input.verification.account.id,
        scopes: input.verification.pageToken.scopes,
        capabilities: input.verification.capabilities,
      },
    });
    await credentialRepository.upsert(
      page.id,
      input.verification.pageCredential,
      unixSecondsToDate(input.verification.pageToken.expiresAt),
    );
    await connectionRepository.markActive({
      externalUserId: input.verification.account.id,
      grantedScopes: input.verification.userToken.scopes,
      tokenExpiresAt:
        unixSecondsToDate(input.verification.userToken.expiresAt) ?? null,
      providerMetadata: {
        accountName: input.verification.account.name,
        accountAvatarUrl: input.verification.account.avatarUrl,
        appId: input.verification.userToken.appId,
        dataAccessExpiresAt: unixSecondsToIso(
          input.verification.userToken.dataAccessExpiresAt,
        ),
      },
    });

    return toSafeManualPage(input.verification, page.id);
  });
}
