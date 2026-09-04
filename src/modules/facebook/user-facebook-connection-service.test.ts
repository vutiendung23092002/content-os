import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const mocks = vi.hoisted(() => ({
  stateCreate: vi.fn(),
  stateConsume: vi.fn(),
  upsertConnection: vi.fn(),
  findConnection: vi.fn(),
  findOwnedConnection: vi.fn(),
  markDisconnected: vi.fn(),
  markStatus: vi.fn(),
  revokeCredentials: vi.fn(),
  listCredentialPageIds: vi.fn(),
  reconcileConnectionHealth: vi.fn(),
  deleteAssignments: vi.fn(),
  assignPage: vi.fn(),
  upsertCredential: vi.fn(),
  findCredentialByConnection: vi.fn(),
  findPage: vi.fn(),
  upsertPage: vi.fn(),
  authorizationUrl: vi.fn(),
  exchangeCode: vi.fn(),
  exchangeLongLived: vi.fn(),
  getCurrentUser: vi.fn(),
  inspectCurrentToken: vi.fn(),
  getManagedPages: vi.fn(),
  verifyManualPage: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getDatabase: () => ({}),
  runInTransaction: (work: (transaction: object) => unknown) => work({}),
}));
vi.mock("@/db/repositories/facebook-oauth-state-repository", () => ({
  FacebookOauthStateRepository: class {
    create = mocks.stateCreate;
    consume = mocks.stateConsume;
  },
}));
vi.mock("@/db/repositories/facebook-connection-repository", () => ({
  FacebookConnectionRepository: class {
    upsertUserConnected = mocks.upsertConnection;
    findUserConnection = mocks.findConnection;
    findOwnedUserConnection = mocks.findOwnedConnection;
    markDisconnected = mocks.markDisconnected;
    markStatus = mocks.markStatus;
  },
}));
vi.mock("@/db/repositories/page-credential-repository", () => ({
  PageCredentialRepository: class {
    upsert = mocks.upsertCredential;
    findByPageAndConnection = mocks.findCredentialByConnection;
    markRevokedByConnection = mocks.revokeCredentials;
    listPageIdsForConnection = mocks.listCredentialPageIds;
  },
}));
vi.mock("./page-credential-health", () => ({
  reconcileConnectionPageCredentialHealth: mocks.reconcileConnectionHealth,
}));
vi.mock("@/db/repositories/user-page-assignment-repository", () => ({
  UserPageAssignmentRepository: class {
    assignFromConnection = mocks.assignPage;
    deleteForConnection = mocks.deleteAssignments;
  },
}));
vi.mock("@/db/repositories/page-repository", () => ({
  PageRepository: class {
    findByExternalId = mocks.findPage;
    upsertManagedPage = mocks.upsertPage;
  },
}));
vi.mock("./facebook-connect-config", () => ({
  getFacebookConnectConfig: () => ({
    appId: "app-b",
    appSecret: "app-b-secret",
    graphVersion: "v26.0",
    redirectUri: "https://social.example/api/facebook/callback",
  }),
}));
vi.mock("./meta-oauth-client", () => ({
  MetaOauthClient: class {
    authorizationUrl = mocks.authorizationUrl;
    exchangeCode = mocks.exchangeCode;
    exchangeLongLived = mocks.exchangeLongLived;
  },
}));
vi.mock("./meta-client", () => ({
  MetaGraphClient: class {
    getCurrentUser = mocks.getCurrentUser;
    inspectCurrentToken = mocks.inspectCurrentToken;
    getManagedPages = mocks.getManagedPages;
  },
}));
vi.mock("./manual-page-service", () => ({
  verifyManualPage: mocks.verifyManualPage,
}));

import { UserFacebookConnectionService } from "./user-facebook-connection-service";

const viewer = {
  id: "11111111-1111-4111-8111-111111111111",
  externalUserId: "google-user",
  email: "user@example.test",
  name: "User",
  role: "member" as const,
  approvalStatus: "approved" as const,
  isBootstrapSuperAdmin: false,
};
const encrypted = {
  ciphertext: Buffer.from("cipher"),
  nonce: Buffer.from("nonce"),
  authTag: Buffer.from("tag"),
  keyVersion: 2,
  fingerprint: "fingerprint",
};
const keyring = {
  currentVersion: 2,
  encrypt: vi.fn(() => encrypted),
  decrypt: vi.fn(() => "stored-user-token"),
  reencrypt: vi.fn(),
  hasVersion: vi.fn(),
};

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    appUserId: viewer.id,
    externalUserId: "facebook-user",
    metaAppId: "app-b",
    connectionType: "user_connected",
    status: "active",
    accountName: "Facebook User",
    accountAvatarUrl: null,
    grantedScopes: ["pages_show_list"],
    tokenExpiresAt: null,
    dataAccessExpiresAt: null,
    userTokenCiphertext: encrypted.ciphertext,
    userTokenNonce: encrypted.nonce,
    userTokenAuthTag: encrypted.authTag,
    userTokenKeyVersion: encrypted.keyVersion,
    userTokenFingerprint: encrypted.fingerprint,
    ...overrides,
  };
}

describe("UserFacebookConnectionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizationUrl.mockImplementation(
      (state: string) => `https://www.facebook.com/dialog/oauth?state=${state}`,
    );
    mocks.stateConsume.mockResolvedValue({
      stateHash: "hash",
      redirectPath: "/pages",
    });
    mocks.exchangeCode.mockResolvedValue({ accessToken: "short-token" });
    mocks.exchangeLongLived.mockResolvedValue({ accessToken: "long-token" });
    mocks.getCurrentUser.mockResolvedValue({
      id: "facebook-user",
      name: "Facebook User",
    });
    mocks.inspectCurrentToken.mockResolvedValue({
      isValid: true,
      appId: "app-b",
      userId: "facebook-user",
      scopes: ["pages_show_list"],
    });
    mocks.upsertConnection.mockResolvedValue(connection());
    mocks.findConnection.mockResolvedValue(connection());
    mocks.findOwnedConnection.mockResolvedValue(connection());
    mocks.getManagedPages.mockResolvedValue({ pages: [], after: undefined });
    mocks.markDisconnected.mockResolvedValue(true);
    mocks.listCredentialPageIds.mockResolvedValue([
      "33333333-3333-4333-8333-333333333333",
    ]);
    mocks.reconcileConnectionHealth.mockResolvedValue(undefined);
    mocks.upsertPage.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("stores only a hash of a short-lived OAuth state", async () => {
    const url = await new UserFacebookConnectionService(keyring as never).begin(
      viewer,
    );
    const state = new URL(url).searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(mocks.stateCreate.mock.calls[0]?.[0].stateHash).not.toBe(state);
    expect(JSON.stringify(mocks.stateCreate.mock.calls[0]?.[0])).not.toContain(
      "app-b-secret",
    );
  });

  it("rejects expired, replayed or wrong-user state before token exchange", async () => {
    mocks.stateConsume.mockResolvedValue(undefined);
    await expect(
      new UserFacebookConnectionService(keyring as never).complete({
        viewer,
        state: "x".repeat(43),
        code: "code",
      }),
    ).rejects.toMatchObject({ code: "FACEBOOK_OAUTH_STATE_INVALID" });
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects an OAuth state bound to another callback intent", async () => {
    mocks.stateConsume.mockResolvedValue({
      stateHash: "hash",
      redirectPath: "/admin",
    });

    await expect(
      new UserFacebookConnectionService(keyring as never).complete({
        viewer,
        state: "x".repeat(43),
        code: "code",
      }),
    ).rejects.toMatchObject({ code: "FACEBOOK_OAUTH_STATE_INVALID" });
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects a token from Meta App A in the App B callback", async () => {
    mocks.inspectCurrentToken.mockResolvedValue({
      isValid: true,
      appId: "app-a",
      userId: "facebook-user",
      scopes: [],
    });
    await expect(
      new UserFacebookConnectionService(keyring as never).complete({
        viewer,
        state: "x".repeat(43),
        code: "code",
      }),
    ).rejects.toMatchObject({ code: "FACEBOOK_CONNECT_TOKEN_INVALID" });
    expect(mocks.upsertConnection).not.toHaveBeenCalled();
  });

  it("rejects a Facebook user mismatch in the App B callback", async () => {
    mocks.inspectCurrentToken.mockResolvedValue({
      isValid: true,
      appId: "app-b",
      userId: "different-facebook-user",
      scopes: [],
    });

    await expect(
      new UserFacebookConnectionService(keyring as never).complete({
        viewer,
        state: "x".repeat(43),
        code: "code",
      }),
    ).rejects.toMatchObject({ code: "FACEBOOK_CONNECT_TOKEN_INVALID" });
    expect(mocks.upsertConnection).not.toHaveBeenCalled();
  });

  it("persists a valid App B token encrypted and scoped to the viewer", async () => {
    await new UserFacebookConnectionService(keyring as never).complete({
      viewer,
      state: "x".repeat(43),
      code: "code",
    });
    expect(keyring.encrypt).toHaveBeenCalledWith("long-token");
    expect(mocks.upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        appUserId: viewer.id,
        metaAppId: "app-b",
        externalUserId: "facebook-user",
        encryptedUserToken: encrypted,
      }),
    );
    expect(mocks.revokeCredentials).not.toHaveBeenCalled();
    expect(mocks.deleteAssignments).not.toHaveBeenCalled();
  });

  it("atomically invalidates derived state before switching Facebook identity", async () => {
    mocks.findConnection.mockResolvedValue(
      connection({ externalUserId: "old-facebook-user" }),
    );

    await new UserFacebookConnectionService(keyring as never).complete({
      viewer,
      state: "x".repeat(43),
      code: "code",
    });

    expect(mocks.revokeCredentials).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(mocks.deleteAssignments).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(mocks.revokeCredentials.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsertConnection.mock.invocationCallOrder[0]!,
    );
    expect(mocks.deleteAssignments.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsertConnection.mock.invocationCallOrder[0]!,
    );
    expect(mocks.reconcileConnectionHealth).toHaveBeenCalledWith(
      {},
      ["33333333-3333-4333-8333-333333333333"],
      {
        status: "revoked",
        errorCode: "FACEBOOK_CONNECTION_IDENTITY_CHANGED",
      },
    );
    expect(
      mocks.reconcileConnectionHealth.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.upsertConnection.mock.invocationCallOrder[0]!);
  });

  it("reactivates a disconnected same-account connection without reviving Page credentials", async () => {
    mocks.findConnection.mockResolvedValue(connection({ status: "revoked" }));

    await new UserFacebookConnectionService(keyring as never).complete({
      viewer,
      state: "x".repeat(43),
      code: "code",
    });

    expect(mocks.upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserId: "facebook-user" }),
    );
    expect(mocks.revokeCredentials).not.toHaveBeenCalled();
    expect(mocks.deleteAssignments).not.toHaveBeenCalled();
  });

  it("persists a sanitized expired status for only the current connection", async () => {
    mocks.findConnection.mockResolvedValue(
      connection({ tokenExpiresAt: new Date("2026-01-01T00:00:00.000Z") }),
    );

    const result = await new UserFacebookConnectionService(
      keyring as never,
      () => new Date("2026-09-04T00:00:00.000Z"),
    ).get(viewer);

    expect(result?.status).toBe("expired");
    expect(mocks.markStatus).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "expired",
      expect.objectContaining({
        credentialIncident: {
          version: 1,
          status: "expired",
          errorCode: "FACEBOOK_CONNECTION_EXPIRED",
          detectedAt: "2026-09-04T00:00:00.000Z",
        },
      }),
    );
    expect(JSON.stringify(mocks.markStatus.mock.calls)).not.toContain(
      "stored-user-token",
    );
  });

  it("does not let one user disconnect another user's connection", async () => {
    mocks.findOwnedConnection.mockResolvedValue(undefined);
    await expect(
      new UserFacebookConnectionService(keyring as never).disconnect(
        viewer,
        "22222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toMatchObject({ code: "FACEBOOK_CONNECTION_NOT_FOUND" });
    expect(mocks.markDisconnected).not.toHaveBeenCalled();
    expect(mocks.revokeCredentials).not.toHaveBeenCalled();
  });

  it("does not let one user select Pages from another user's connection", async () => {
    mocks.findOwnedConnection.mockResolvedValue(undefined);

    await expect(
      new UserFacebookConnectionService(keyring as never).connectPages({
        viewer,
        connectionId: "22222222-2222-4222-8222-222222222222",
        pageIds: ["12345"],
      }),
    ).rejects.toMatchObject({ code: "FACEBOOK_CONNECTION_INACTIVE" });
    expect(mocks.verifyManualPage).not.toHaveBeenCalled();
    expect(mocks.upsertCredential).not.toHaveBeenCalled();
  });

  it("rejects a selected Page that was not discovered through the owned connection", async () => {
    mocks.getManagedPages.mockResolvedValue({
      pages: [
        {
          externalPageId: "12345",
          name: "Owned Page",
          accessToken: "raw-page-token",
          tasks: ["CREATE_CONTENT"],
        },
      ],
    });

    await expect(
      new UserFacebookConnectionService(keyring as never).connectPages({
        viewer,
        connectionId: "22222222-2222-4222-8222-222222222222",
        pageIds: ["67890"],
      }),
    ).rejects.toMatchObject({ code: "FACEBOOK_PAGE_NOT_OWNED" });
    expect(mocks.verifyManualPage).not.toHaveBeenCalled();
  });

  it.each([
    "FACEBOOK_PAGE_TOKEN_INVALID",
    "FACEBOOK_PAGE_ID_MISMATCH",
    "FACEBOOK_USER_TOKEN_INVALID",
  ])(
    "does not persist a Page when verification fails with %s",
    async (code) => {
      mocks.getManagedPages.mockResolvedValue({
        pages: [
          {
            externalPageId: "12345",
            name: "Owned Page",
            accessToken: "raw-page-token",
            tasks: [],
          },
        ],
      });
      mocks.verifyManualPage.mockRejectedValue(
        new AppError({
          code,
          message: "Safe verification failure",
          status: 403,
        }),
      );

      await expect(
        new UserFacebookConnectionService(keyring as never).connectPages({
          viewer,
          connectionId: "22222222-2222-4222-8222-222222222222",
          pageIds: ["12345"],
        }),
      ).rejects.toMatchObject({ code });
      expect(mocks.upsertPage).not.toHaveBeenCalled();
      expect(mocks.upsertCredential).not.toHaveBeenCalled();
      expect(mocks.assignPage).not.toHaveBeenCalled();
    },
  );

  it("discovers Pages without returning tokens and reports this connection's state", async () => {
    mocks.getManagedPages.mockResolvedValue({
      pages: [
        {
          externalPageId: "12345",
          name: "Owned Page",
          accessToken: "raw-page-token",
          tasks: ["CREATE_CONTENT"],
        },
      ],
    });
    mocks.findPage.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
    });
    mocks.findCredentialByConnection.mockResolvedValue({ revokedAt: null });

    const result = await new UserFacebookConnectionService(
      keyring as never,
    ).discover(viewer);

    expect(result.pages).toEqual([
      expect.objectContaining({
        externalPageId: "12345",
        alreadyConnected: true,
      }),
    ]);
    expect(mocks.findCredentialByConnection).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(JSON.stringify(result)).not.toContain("raw-page-token");
    expect(JSON.stringify(result)).not.toContain("stored-user-token");
  });

  it("locks only the failing App B connection on a definitive token error", async () => {
    mocks.getManagedPages.mockRejectedValue(
      new AppError({
        code: "FACEBOOK_TOKEN_INVALID",
        message: "Invalid token",
        status: 403,
      }),
    );

    await expect(
      new UserFacebookConnectionService(keyring as never).discover(viewer),
    ).rejects.toMatchObject({ code: "FACEBOOK_TOKEN_INVALID" });
    expect(mocks.markStatus).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "revoked",
      expect.objectContaining({
        credentialIncident: expect.objectContaining({
          errorCode: "FACEBOOK_TOKEN_INVALID",
        }),
      }),
    );
    expect(mocks.revokeCredentials).not.toHaveBeenCalled();
  });

  it("persists a verified encrypted Page credential, provenance and assignment", async () => {
    mocks.getManagedPages.mockResolvedValue({
      pages: [
        {
          externalPageId: "12345",
          name: "Owned Page",
          accessToken: "raw-page-token",
          tasks: ["CREATE_CONTENT"],
        },
      ],
    });
    mocks.verifyManualPage.mockResolvedValue({
      account: { id: "facebook-user", name: "Facebook User" },
      userToken: {
        appId: "app-b",
        isValid: true,
        userId: "facebook-user",
        scopes: ["pages_show_list"],
      },
      page: { externalPageId: "12345", name: "Owned Page" },
      pageToken: {
        appId: "app-b",
        isValid: true,
        type: "PAGE",
        profileId: "12345",
        scopes: ["pages_manage_posts"],
      },
      pageCredential: encrypted,
      capabilities: {
        readPublishedPosts: true,
        readScheduledPosts: true,
        managePostsScope: true,
        manageEngagementScope: false,
        readInsightsScope: false,
        manageMetadataScope: false,
      },
    });

    const result = await new UserFacebookConnectionService(
      keyring as never,
    ).connectPages({
      viewer,
      connectionId: "22222222-2222-4222-8222-222222222222",
      pageIds: ["12345"],
    });

    expect(mocks.verifyManualPage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "12345",
        appId: "app-b",
        appSecret: "app-b-secret",
        userAccessToken: "stored-user-token",
      }),
    );
    expect(mocks.upsertCredential).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      encrypted,
      undefined,
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        source: "user_connected",
        ownerFacebookUserId: "facebook-user",
        metaAppId: "app-b",
        scopes: ["pages_manage_posts"],
      }),
    );
    expect(mocks.assignPage).toHaveBeenCalledWith({
      userId: viewer.id,
      pageId: "33333333-3333-4333-8333-333333333333",
      facebookConnectionId: "22222222-2222-4222-8222-222222222222",
    });
    expect(JSON.stringify(result)).not.toContain("raw-page-token");
    expect(JSON.stringify(result)).not.toContain("app-b-secret");
  });

  it("disconnects only the owned connection and its derived records", async () => {
    await new UserFacebookConnectionService(keyring as never).disconnect(
      viewer,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(mocks.markDisconnected).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      viewer.id,
    );
    expect(mocks.revokeCredentials).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(mocks.deleteAssignments).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(mocks.reconcileConnectionHealth).toHaveBeenCalledWith(
      {},
      ["33333333-3333-4333-8333-333333333333"],
      {
        status: "revoked",
        errorCode: "FACEBOOK_CONNECTION_DISCONNECTED",
      },
    );
  });
});
