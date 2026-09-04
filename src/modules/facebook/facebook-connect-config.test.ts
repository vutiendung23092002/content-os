import { afterEach, describe, expect, it, vi } from "vitest";
import { __testing } from "@/lib/env/server";
import { getFacebookConnectConfig } from "./facebook-connect-config";

describe("Facebook App B configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    __testing.reset();
  });

  function configure() {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://social.example");
    vi.stubEnv("FACEBOOK_APP_ID", "app-a");
    vi.stubEnv("FACEBOOK_CONNECT_APP_ID", "app-b");
    vi.stubEnv("FACEBOOK_CONNECT_APP_SECRET", "app-b-secret");
    vi.stubEnv("FACEBOOK_GRAPH_API_VERSION", "v26.0");
    vi.stubEnv("FACEBOOK_CONNECT_REDIRECT_URI", "");
    __testing.reset();
  }

  it("derives the fixed callback path from the public site origin", () => {
    configure();

    expect(getFacebookConnectConfig()).toMatchObject({
      appId: "app-b",
      graphVersion: "v26.0",
      redirectUri: "https://social.example/api/facebook/callback",
    });
  });

  it.each([
    "https://other.example/api/facebook/callback",
    "https://social.example/different-callback",
    "https://social.example/api/facebook/callback?next=/admin",
    "not-a-url",
    "https://user:password@social.example/api/facebook/callback",
  ])("rejects an unsafe explicit callback URL: %s", (redirectUri) => {
    configure();
    vi.stubEnv("FACEBOOK_CONNECT_REDIRECT_URI", redirectUri);
    __testing.reset();

    let error: unknown;
    try {
      getFacebookConnectConfig();
    } catch (reason) {
      error = reason;
    }
    expect(error).toMatchObject({
      code: "FACEBOOK_CONNECT_REDIRECT_URI_INVALID",
    });
  });

  it("rejects using the admin-managed Meta App as App B", () => {
    configure();
    vi.stubEnv("FACEBOOK_CONNECT_APP_ID", "app-a");
    __testing.reset();

    expect(() => getFacebookConnectConfig()).toThrowError(
      expect.objectContaining({ code: "FACEBOOK_CONNECT_APP_NOT_DISTINCT" }),
    );
  });

  it("rejects a public site URL containing credentials", () => {
    configure();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://user:password@social.example");
    __testing.reset();

    expect(() => getFacebookConnectConfig()).toThrowError(
      expect.objectContaining({
        code: "FACEBOOK_CONNECT_REDIRECT_URI_INVALID",
      }),
    );
  });
});
