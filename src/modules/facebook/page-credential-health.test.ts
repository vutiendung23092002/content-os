import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasUsableCredentialForPage: vi.fn(),
  lockForCredentialIncident: vi.fn(),
}));

vi.mock("@/db/repositories/page-credential-repository", () => ({
  PageCredentialRepository: class {
    hasUsableCredentialForPage = mocks.hasUsableCredentialForPage;
  },
}));

vi.mock("@/db/repositories/page-repository", () => ({
  PageRepository: class {
    lockForCredentialIncident = mocks.lockForCredentialIncident;
  },
}));

import {
  reconcileConnectionPageCredentialHealth,
  reconcilePageCredentialHealth,
} from "./page-credential-health";

const pageId = "11111111-1111-4111-8111-111111111111";
const detectedAt = new Date("2026-09-05T00:00:00.000Z");

describe("Page credential health reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockForCredentialIncident.mockResolvedValue(undefined);
  });

  it("keeps Page health usable when an alternate credential remains", async () => {
    mocks.hasUsableCredentialForPage.mockResolvedValue(true);

    await expect(
      reconcilePageCredentialHealth({} as never, pageId, {
        status: "expired",
        errorCode: "FACEBOOK_CONNECTION_EXPIRED",
        detectedAt,
      }),
    ).resolves.toBe("usable");

    expect(mocks.lockForCredentialIncident).not.toHaveBeenCalled();
  });

  it("locks only the affected Page when no usable credential remains", async () => {
    mocks.hasUsableCredentialForPage.mockResolvedValue(false);

    await expect(
      reconcilePageCredentialHealth({} as never, pageId, {
        status: "error",
        errorCode: "TOKEN_DECRYPTION_FAILED",
        detectedAt,
      }),
    ).resolves.toBe("locked");

    expect(mocks.lockForCredentialIncident).toHaveBeenCalledWith({
      pageId,
      status: "error",
      errorCode: "TOKEN_DECRYPTION_FAILED",
      operationId: undefined,
      detectedAt,
      credentialExpiresAt: undefined,
    });
  });

  it("reconciles each affected Page once", async () => {
    mocks.hasUsableCredentialForPage.mockResolvedValue(true);

    await reconcileConnectionPageCredentialHealth(
      {} as never,
      [pageId, pageId],
      {
        status: "expired",
        errorCode: "FACEBOOK_CONNECTION_EXPIRED",
        detectedAt,
      },
    );

    expect(mocks.hasUsableCredentialForPage).toHaveBeenCalledOnce();
    expect(mocks.hasUsableCredentialForPage).toHaveBeenCalledWith({
      pageId,
      now: detectedAt,
    });
  });
});
