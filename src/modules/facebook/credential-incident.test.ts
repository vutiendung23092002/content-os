import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import {
  assertPageReadyForMutation,
  getPageCredentialIncidentStatus,
} from "./credential-incident";

describe("Page credential incident guard", () => {
  it("classifies only definitive credential failures", () => {
    expect(
      getPageCredentialIncidentStatus(
        new AppError({
          code: "FACEBOOK_TOKEN_INVALID",
          message: "invalid",
          status: 403,
        }),
      ),
    ).toBe("revoked");
    expect(
      getPageCredentialIncidentStatus(
        new AppError({
          code: "FACEBOOK_PERMISSION_DENIED",
          message: "permission",
          status: 403,
        }),
      ),
    ).toBe("permission_missing");
    expect(
      getPageCredentialIncidentStatus(
        new AppError({
          code: "FACEBOOK_NETWORK_ERROR",
          message: "network",
          retryable: true,
        }),
      ),
    ).toBeNull();
    expect(
      getPageCredentialIncidentStatus(
        new AppError({
          code: "UNKNOWN_TOKEN_KEY_VERSION",
          message: "unknown version",
        }),
      ),
    ).toBe("error");
  });

  it("locks mutations while invalid and allows them after verified recovery", () => {
    expect(() =>
      assertPageReadyForMutation(
        { isActive: true, connectionStatus: "revoked" },
        "inactive",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PAGE_CREDENTIAL_MUTATION_LOCKED" }),
    );

    expect(() =>
      assertPageReadyForMutation(
        { isActive: true, connectionStatus: "active" },
        "inactive",
      ),
    ).not.toThrow();
  });
});
