import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markConnectionStatus: vi.fn(),
  markLegacyRevoked: vi.fn(),
  markRevokedById: vi.fn(),
  hasUsableCredentialForPage: vi.fn(),
  lockForCredentialIncident: vi.fn(),
}));

vi.mock("@/db/repositories/facebook-connection-repository", () => ({
  FacebookConnectionRepository: class {
    markStatus = mocks.markConnectionStatus;
  },
}));

vi.mock("@/db/repositories/page-credential-repository", () => ({
  PageCredentialRepository: class {
    markLegacyRevoked = mocks.markLegacyRevoked;
    markRevokedById = mocks.markRevokedById;
    hasUsableCredentialForPage = mocks.hasUsableCredentialForPage;
  },
}));

vi.mock("@/db/repositories/page-repository", () => ({
  PageRepository: class {
    lockForCredentialIncident = mocks.lockForCredentialIncident;
  },
}));

import { recordPageCredentialIncident } from "./credential-incident";

const pageId = "11111111-1111-4111-8111-111111111111";
const credentialId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const detectedAt = new Date("2026-09-04T00:00:00.000Z");

describe("Page credential incident isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markConnectionStatus.mockResolvedValue(true);
    mocks.markLegacyRevoked.mockResolvedValue(true);
    mocks.markRevokedById.mockResolvedValue(true);
    mocks.lockForCredentialIncident.mockResolvedValue(undefined);
  });

  it("revokes only legacy App A and keeps Page active when another credential is usable", async () => {
    mocks.hasUsableCredentialForPage.mockResolvedValue(true);

    await recordPageCredentialIncident({} as never, {
      pageId,
      credentialId,
      facebookConnectionId: null,
      status: "revoked",
      errorCode: "FACEBOOK_TOKEN_INVALID",
      detectedAt,
    });

    expect(mocks.markLegacyRevoked).toHaveBeenCalledWith(pageId, detectedAt);
    expect(mocks.markRevokedById).not.toHaveBeenCalled();
    expect(mocks.markConnectionStatus).not.toHaveBeenCalled();
    expect(mocks.hasUsableCredentialForPage).toHaveBeenCalledWith({
      pageId,
      excludingCredentialId: credentialId,
      excludingConnectionId: undefined,
      excludingLegacy: true,
      now: detectedAt,
    });
    expect(mocks.lockForCredentialIncident).not.toHaveBeenCalled();
  });

  it("isolates an App B incident and does not globally lock while an alternate remains", async () => {
    mocks.hasUsableCredentialForPage.mockResolvedValue(true);

    await recordPageCredentialIncident({} as never, {
      pageId,
      credentialId,
      facebookConnectionId: connectionId,
      status: "revoked",
      errorCode: "FACEBOOK_TOKEN_INVALID",
      detectedAt,
    });

    expect(mocks.markConnectionStatus).toHaveBeenCalledWith(
      connectionId,
      "revoked",
    );
    expect(mocks.markRevokedById).toHaveBeenCalledWith(
      credentialId,
      detectedAt,
    );
    expect(mocks.markLegacyRevoked).not.toHaveBeenCalled();
    expect(mocks.lockForCredentialIncident).not.toHaveBeenCalled();
  });

  it("locks Page health after the final usable credential fails", async () => {
    mocks.hasUsableCredentialForPage.mockResolvedValue(false);

    await recordPageCredentialIncident({} as never, {
      pageId,
      credentialId,
      facebookConnectionId: connectionId,
      status: "revoked",
      errorCode: "FACEBOOK_TOKEN_INVALID",
      detectedAt,
    });

    expect(mocks.lockForCredentialIncident).toHaveBeenCalledWith({
      pageId,
      status: "revoked",
      errorCode: "FACEBOOK_TOKEN_INVALID",
      operationId: undefined,
      detectedAt,
      credentialExpiresAt: undefined,
    });
  });
});
