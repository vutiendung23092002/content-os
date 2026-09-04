import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  getDatabase,
  runInTransaction,
  type DatabaseExecutor,
} from "@/db/client";
import { FacebookConnectionRepository } from "@/db/repositories/facebook-connection-repository";
import { FacebookOauthStateRepository } from "@/db/repositories/facebook-oauth-state-repository";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import { UserPageAssignmentRepository } from "@/db/repositories/user-page-assignment-repository";
import { getTokenKeyring, type TokenKeyring } from "@/lib/crypto/token-keyring";
import type { Viewer } from "@/lib/auth/types";
import { AppError } from "@/lib/errors/app-error";
import { getPageCredentialIncidentStatus } from "./credential-incident";
import { getFacebookConnectConfig } from "./facebook-connect-config";
import {
  verifyManualPage,
  type VerifiedManualPage,
} from "./manual-page-service";
import { MetaGraphClient, type ManagedPageCredential } from "./meta-client";
import { MetaOauthClient } from "./meta-oauth-client";
import { reconcileConnectionPageCredentialHealth } from "./page-credential-health";

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const MAX_PAGE_BATCHES = 20;
const connectPageIdsSchema = z
  .array(z.string().regex(/^\d{5,30}$/))
  .min(1)
  .max(100);
export const facebookConnectScopes = [
  "public_profile",
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_posts",
] as const;

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function unixDate(value?: number): Date | undefined {
  return value && value > 0 ? new Date(value * 1000) : undefined;
}

function incidentMetadata(
  connection: { providerMetadata: Record<string, unknown> },
  status: "expired" | "revoked" | "permission_missing" | "error",
  errorCode: string,
  detectedAt: Date,
) {
  return {
    ...connection.providerMetadata,
    credentialIncident: {
      version: 1,
      status,
      errorCode,
      detectedAt: detectedAt.toISOString(),
    },
  };
}

function storedUserToken(connection: {
  userTokenCiphertext: Buffer | null;
  userTokenNonce: Buffer | null;
  userTokenAuthTag: Buffer | null;
  userTokenKeyVersion: number | null;
  userTokenFingerprint: string | null;
}) {
  if (
    !connection.userTokenCiphertext ||
    !connection.userTokenNonce ||
    !connection.userTokenAuthTag ||
    !connection.userTokenKeyVersion ||
    !connection.userTokenFingerprint
  ) {
    throw new AppError({
      code: "FACEBOOK_CONNECTION_CREDENTIAL_MISSING",
      message: "Kết nối Facebook cần được thực hiện lại.",
      status: 409,
    });
  }
  return {
    ciphertext: connection.userTokenCiphertext,
    nonce: connection.userTokenNonce,
    authTag: connection.userTokenAuthTag,
    keyVersion: connection.userTokenKeyVersion,
    fingerprint: connection.userTokenFingerprint,
  };
}

export type SafeUserFacebookConnection = {
  id: string;
  status: string;
  account: { id: string; name: string; avatarUrl?: string };
  scopes: string[];
  tokenExpiresAt: string | null;
  dataAccessExpiresAt: string | null;
};

type PersistUserConnectionInput = {
  appUserId: string;
  externalUserId: string;
  metaAppId: string;
  accountName: string;
  accountAvatarUrl?: string;
  grantedScopes: string[];
  tokenExpiresAt?: Date;
  dataAccessExpiresAt?: Date;
  encryptedUserToken: ReturnType<TokenKeyring["encrypt"]>;
  providerMetadata?: Record<string, unknown>;
};

export async function persistUserFacebookConnection(
  database: DatabaseExecutor,
  input: PersistUserConnectionInput,
) {
  const connections = new FacebookConnectionRepository(database);
  const existing = await connections.findUserConnection(
    input.appUserId,
    input.metaAppId,
  );
  if (existing && existing.externalUserId !== input.externalUserId) {
    const credentials = new PageCredentialRepository(database);
    const affectedPageIds = await credentials.listPageIdsForConnection(
      existing.id,
    );
    await credentials.markRevokedByConnection(existing.id);
    await new UserPageAssignmentRepository(database).deleteForConnection(
      existing.id,
    );
    await reconcileConnectionPageCredentialHealth(database, affectedPageIds, {
      status: "revoked",
      errorCode: "FACEBOOK_CONNECTION_IDENTITY_CHANGED",
    });
  }
  return connections.upsertUserConnected(input);
}

export class UserFacebookConnectionService {
  constructor(
    private readonly keyring: TokenKeyring = getTokenKeyring(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async begin(viewer: Viewer): Promise<string> {
    const config = getFacebookConnectConfig();
    const state = randomBytes(32).toString("base64url");
    await new FacebookOauthStateRepository(getDatabase()).create({
      stateHash: hashState(state),
      appUserId: viewer.id,
      redirectPath: "/pages",
      expiresAt: new Date(this.now().getTime() + OAUTH_STATE_TTL_MS),
    });
    return new MetaOauthClient(config).authorizationUrl(state, [
      ...facebookConnectScopes,
    ]);
  }

  async complete(input: { viewer: Viewer; state: string; code: string }) {
    const state = z.string().min(32).max(256).parse(input.state);
    const code = z.string().min(1).max(2048).parse(input.code);
    const consumed = await new FacebookOauthStateRepository(
      getDatabase(),
    ).consume({
      stateHash: hashState(state),
      appUserId: input.viewer.id,
      now: this.now(),
    });
    if (!consumed || consumed.redirectPath !== "/pages") {
      throw new AppError({
        code: "FACEBOOK_OAUTH_STATE_INVALID",
        message: "Phiên kết nối Facebook đã hết hạn hoặc đã được sử dụng.",
        status: 403,
      });
    }

    const config = getFacebookConnectConfig();
    const oauth = new MetaOauthClient(config);
    const shortLived = await oauth.exchangeCode(code);
    const token = await oauth.exchangeLongLived(shortLived.accessToken);
    const client = new MetaGraphClient({
      graphVersion: config.graphVersion,
      accessToken: token.accessToken,
    });
    const [account, inspection] = await Promise.all([
      client.getCurrentUser(),
      client.inspectCurrentToken({
        appId: config.appId,
        appSecret: config.appSecret,
      }),
    ]);
    if (
      !inspection.isValid ||
      inspection.appId !== config.appId ||
      inspection.userId !== account.id
    ) {
      throw new AppError({
        code: "FACEBOOK_CONNECT_TOKEN_INVALID",
        message: "Facebook token không thuộc đúng tài khoản hoặc Meta App.",
        status: 403,
      });
    }

    const encryptedUserToken = this.keyring.encrypt(token.accessToken);
    return runInTransaction((transaction) =>
      persistUserFacebookConnection(transaction, {
        appUserId: input.viewer.id,
        externalUserId: account.id,
        metaAppId: config.appId,
        accountName: account.name,
        accountAvatarUrl: account.avatarUrl,
        grantedScopes: inspection.scopes,
        tokenExpiresAt: unixDate(inspection.expiresAt),
        dataAccessExpiresAt: unixDate(inspection.dataAccessExpiresAt),
        encryptedUserToken,
        providerMetadata: { oauthVersion: 1 },
      }),
    );
  }

  async rejectCallback(viewer: Viewer, stateInput: string): Promise<void> {
    const state = z.string().min(32).max(256).parse(stateInput);
    const consumed = await new FacebookOauthStateRepository(
      getDatabase(),
    ).consume({
      stateHash: hashState(state),
      appUserId: viewer.id,
      now: this.now(),
    });
    if (!consumed || consumed.redirectPath !== "/pages") {
      throw new AppError({
        code: "FACEBOOK_OAUTH_STATE_INVALID",
        message: "Phiên kết nối Facebook đã hết hạn hoặc đã được sử dụng.",
        status: 403,
      });
    }
  }

  async get(viewer: Viewer): Promise<SafeUserFacebookConnection | null> {
    const config = getFacebookConnectConfig();
    const repository = new FacebookConnectionRepository(getDatabase());
    const connection = await repository.findUserConnection(
      viewer.id,
      config.appId,
    );
    if (!connection) return null;
    const expiration = [
      connection.tokenExpiresAt,
      connection.dataAccessExpiresAt,
    ]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (
      connection.status === "active" &&
      expiration &&
      expiration <= this.now()
    ) {
      await repository.markStatus(
        connection.id,
        "expired",
        incidentMetadata(
          connection,
          "expired",
          "FACEBOOK_CONNECTION_EXPIRED",
          this.now(),
        ),
      );
      connection.status = "expired";
    }
    return {
      id: connection.id,
      status: connection.status,
      account: {
        id: connection.externalUserId ?? "",
        name: connection.accountName ?? "Facebook",
        avatarUrl: connection.accountAvatarUrl ?? undefined,
      },
      scopes: connection.grantedScopes,
      tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
      dataAccessExpiresAt:
        connection.dataAccessExpiresAt?.toISOString() ?? null,
    };
  }

  async discover(viewer: Viewer) {
    const { connection, pages } = await this.loadManagedPages(viewer);
    const pageRepository = new PageRepository(getDatabase());
    const credentialRepository = new PageCredentialRepository(getDatabase());
    return {
      connection: await this.get(viewer),
      pages: await Promise.all(
        pages.map(async ({ accessToken, ...page }) => {
          void accessToken;
          const localPage = await pageRepository.findByExternalId(
            page.externalPageId,
          );
          const credential = localPage
            ? await credentialRepository.findByPageAndConnection(
                localPage.id,
                connection.id,
              )
            : undefined;
          return {
            ...page,
            alreadyConnected: Boolean(credential && !credential.revokedAt),
          };
        }),
      ),
      connectionId: connection.id,
    };
  }

  async connectPages(input: {
    viewer: Viewer;
    connectionId: string;
    pageIds: string[];
  }) {
    const pageIds = [...new Set(connectPageIdsSchema.parse(input.pageIds))];
    const { connection, pages, token } = await this.loadManagedPages(
      input.viewer,
      input.connectionId,
    );
    const discovered = new Map(
      pages.map((page) => [page.externalPageId, page]),
    );
    if (pageIds.some((pageId) => !discovered.has(pageId))) {
      throw new AppError({
        code: "FACEBOOK_PAGE_NOT_OWNED",
        message: "Page đã chọn không thuộc kết nối Facebook của bạn.",
        status: 403,
      });
    }
    const config = getFacebookConnectConfig();
    const verifications: VerifiedManualPage[] = [];
    for (const pageId of pageIds) {
      verifications.push(
        await verifyManualPage({
          pageId,
          graphVersion: config.graphVersion,
          userAccessToken: token,
          appId: config.appId,
          appSecret: config.appSecret,
          tokenEncryption: this.keyring,
        }),
      );
    }

    return runInTransaction(async (transaction) => {
      const pageRepository = new PageRepository(transaction);
      const credentialRepository = new PageCredentialRepository(transaction);
      const assignments = new UserPageAssignmentRepository(transaction);
      const safePages = [];
      for (const verification of verifications) {
        const existingPage = await pageRepository.findByExternalId(
          verification.page.externalPageId,
        );
        const page = await pageRepository.upsertManagedPage({
          externalPageId: verification.page.externalPageId,
          name: verification.page.name,
          avatarUrl: verification.page.avatarUrl,
          category: verification.page.category,
          remoteMetadata: existingPage?.remoteMetadata ?? {},
        });
        await credentialRepository.upsert(
          page.id,
          verification.pageCredential,
          unixDate(verification.pageToken.expiresAt),
          connection.id,
          {
            source: "user_connected",
            verifiedAt: this.now().toISOString(),
            ownerFacebookUserId: connection.externalUserId,
            metaAppId: connection.metaAppId,
            scopes: verification.pageToken.scopes,
            capabilities: verification.capabilities,
          },
        );
        await assignments.assignFromConnection({
          userId: input.viewer.id,
          pageId: page.id,
          facebookConnectionId: connection.id,
        });
        safePages.push({ id: page.id, ...verification.page });
      }
      return safePages;
    });
  }

  async disconnect(viewer: Viewer, connectionId: string): Promise<void> {
    const id = z.uuid().parse(connectionId);
    await runInTransaction(async (transaction) => {
      const connections = new FacebookConnectionRepository(transaction);
      const owned = await connections.findOwnedUserConnection(id, viewer.id);
      if (!owned) {
        throw new AppError({
          code: "FACEBOOK_CONNECTION_NOT_FOUND",
          message: "Không tìm thấy kết nối Facebook của bạn.",
          status: 404,
        });
      }
      const credentialRepository = new PageCredentialRepository(transaction);
      const affectedPageIds =
        await credentialRepository.listPageIdsForConnection(id);
      await connections.markDisconnected(id, viewer.id);
      await credentialRepository.markRevokedByConnection(id);
      await new UserPageAssignmentRepository(transaction).deleteForConnection(
        id,
      );
      await reconcileConnectionPageCredentialHealth(
        transaction,
        affectedPageIds,
        {
          status: "revoked",
          errorCode: "FACEBOOK_CONNECTION_DISCONNECTED",
        },
      );
    });
  }

  private async loadManagedPages(viewer: Viewer, expectedId?: string) {
    const config = getFacebookConnectConfig();
    const connection = expectedId
      ? await new FacebookConnectionRepository(
          getDatabase(),
        ).findOwnedUserConnection(expectedId, viewer.id)
      : await new FacebookConnectionRepository(
          getDatabase(),
        ).findUserConnection(viewer.id, config.appId);
    if (
      !connection ||
      connection.metaAppId !== config.appId ||
      connection.status !== "active"
    ) {
      throw new AppError({
        code: "FACEBOOK_CONNECTION_INACTIVE",
        message: "Hãy kết nối lại tài khoản Facebook.",
        status: 409,
      });
    }
    const expiration = [
      connection.tokenExpiresAt,
      connection.dataAccessExpiresAt,
    ]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (expiration && expiration <= this.now()) {
      await new FacebookConnectionRepository(getDatabase()).markStatus(
        connection.id,
        "expired",
        incidentMetadata(
          connection,
          "expired",
          "FACEBOOK_CONNECTION_EXPIRED",
          this.now(),
        ),
      );
      throw new AppError({
        code: "FACEBOOK_CONNECTION_EXPIRED",
        message: "Kết nối Facebook đã hết hạn; hãy kết nối lại.",
        status: 409,
      });
    }
    let token: string;
    try {
      token = this.keyring.decrypt(storedUserToken(connection));
    } catch (error) {
      await new FacebookConnectionRepository(getDatabase()).markStatus(
        connection.id,
        "error",
        incidentMetadata(
          connection,
          "error",
          error instanceof AppError ? error.code : "TOKEN_DECRYPTION_FAILED",
          this.now(),
        ),
      );
      throw error;
    }
    const client = new MetaGraphClient({
      graphVersion: config.graphVersion,
      accessToken: token,
    });
    const pages: ManagedPageCredential[] = [];
    const cursors = new Set<string>();
    let after: string | undefined;
    try {
      for (let batch = 0; batch < MAX_PAGE_BATCHES; batch += 1) {
        const result = await client.getManagedPages(after);
        pages.push(...result.pages);
        if (!result.after) return { connection, pages, token };
        if (cursors.has(result.after)) break;
        cursors.add(result.after);
        after = result.after;
      }
    } catch (error) {
      const status = getPageCredentialIncidentStatus(error);
      if (status) {
        await new FacebookConnectionRepository(getDatabase()).markStatus(
          connection.id,
          status,
          incidentMetadata(
            connection,
            status,
            error instanceof AppError
              ? error.code
              : "FACEBOOK_CREDENTIAL_ERROR",
            this.now(),
          ),
        );
      }
      throw error;
    }
    throw new AppError({
      code: "FACEBOOK_PAGE_DISCOVERY_INCOMPLETE",
      message: "Danh sách Page Facebook quá lớn hoặc pagination không hợp lệ.",
      status: 502,
    });
  }
}

export const __testing = { hashState, storedUserToken };
