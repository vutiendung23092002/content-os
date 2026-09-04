import { describe, expect, it, vi } from "vitest";
import { MetaOauthClient } from "./meta-oauth-client";

function client(fetchImplementation = vi.fn<typeof fetch>()) {
  return new MetaOauthClient({
    graphVersion: "v26.0",
    appId: "connect-app-id",
    appSecret: "connect-app-secret",
    redirectUri: "https://staging.example/api/facebook/callback",
    fetch: fetchImplementation,
  });
}

describe("MetaOauthClient", () => {
  it("builds an App B authorization URL without exposing the app secret", () => {
    const url = new URL(
      client().authorizationUrl("state-value", [
        "pages_show_list",
        "pages_manage_posts",
      ]),
    );

    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("connect-app-id");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.toString()).not.toContain("connect-app-secret");
  });

  it("normalizes a successful authorization-code exchange", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: "user-token", expires_in: 3600 }),
          { status: 200 },
        ),
      );

    await expect(
      client(fetchImplementation).exchangeCode("oauth-code"),
    ).resolves.toEqual({
      accessToken: "user-token",
      expiresIn: 3600,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("returns a safe error for rejected exchanges", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "token details" } }), {
        status: 400,
      }),
    );

    await expect(
      client(fetchImplementation).exchangeCode("bad-code"),
    ).rejects.toMatchObject({
      code: "FACEBOOK_OAUTH_EXCHANGE_FAILED",
      message: expect.not.stringContaining("token details"),
    });
  });

  it("does not retain a network error that may contain the secret request URL", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(
          "request failed: https://graph.facebook.com/oauth?client_secret=connect-app-secret",
        ),
      );

    const error = await client(fetchImplementation)
      .exchangeCode("bad-code")
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "FACEBOOK_OAUTH_NETWORK_ERROR" });
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain("connect-app-secret");
  });
});
