import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TokenKeyring } from "@/lib/crypto/token-keyring";
import { MetaGraphClient } from "./meta-client";
import { toSafeManualPage, verifyManualPage } from "./manual-page-service";

describe("manual Page verification", () => {
  const tokenEncryption = new TokenKeyring({
    currentVersion: 1,
    currentKey: randomBytes(32).toString("base64"),
  });
  it("identifies the token owner and checks Page permissions using GET only", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const requestUrl = new URL(String(url));

      if (requestUrl.pathname.endsWith("/me")) {
        return Response.json({
          id: "user-1",
          name: "Token Owner",
          picture: { data: { url: "https://images.test/user.jpg" } },
        });
      }
      if (requestUrl.pathname.endsWith("/debug_token")) {
        const inspectedToken = requestUrl.searchParams.get("input_token");
        return Response.json({
          data:
            inspectedToken === "user-token"
              ? {
                  app_id: "app-1",
                  is_valid: true,
                  type: "USER",
                  user_id: "user-1",
                  scopes: ["pages_manage_posts", "read_insights"],
                  data_access_expires_at: 1_800_000_000,
                }
              : {
                  app_id: "app-1",
                  is_valid: true,
                  type: "PAGE",
                  profile_id: "123456",
                  scopes: [
                    "pages_manage_posts",
                    "pages_manage_engagement",
                    "read_insights",
                    "pages_manage_metadata",
                  ],
                },
        });
      }
      if (requestUrl.pathname.endsWith("/123456/posts")) {
        return Response.json({ data: [{ id: "123456_post-1" }] });
      }
      if (requestUrl.pathname.endsWith("/123456/scheduled_posts")) {
        return Response.json({ data: [] });
      }
      if (requestUrl.pathname.endsWith("/123456")) {
        return Response.json({
          id: "123456",
          name: "Verified Page",
          access_token: "page-token",
          category: "Community",
        });
      }

      return Response.json({ error: { code: 100 } }, { status: 400 });
    });

    const verification = await verifyManualPage({
      pageId: "123456",
      graphVersion: "v99.0",
      userAccessToken: "user-token",
      appId: "app-1",
      appSecret: "app-secret",
      tokenEncryption,
      clientFactory: (accessToken) =>
        new MetaGraphClient({
          graphVersion: "v99.0",
          accessToken,
          baseUrl: "https://graph.test",
          fetch: fetchMock,
        }),
    });
    const safeResult = toSafeManualPage(verification);

    expect(safeResult.account).toMatchObject({
      id: "user-1",
      name: "Token Owner",
    });
    expect(safeResult.page).toMatchObject({
      externalPageId: "123456",
      name: "Verified Page",
    });
    expect(safeResult.capabilities).toEqual({
      readPublishedPosts: true,
      readScheduledPosts: true,
      managePostsScope: true,
      manageEngagementScope: true,
      readInsightsScope: true,
      manageMetadataScope: true,
    });
    expect(JSON.stringify(safeResult)).not.toContain("user-token");
    expect(JSON.stringify(safeResult)).not.toContain("page-token");

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
    }
    expect(
      fetchMock.mock.calls.map(([url]) => String(url)).join("\n"),
    ).not.toContain("/feed");
  });

  it("rejects invalid Page IDs before calling Meta", async () => {
    const clientFactory = vi.fn();

    await expect(
      verifyManualPage({
        pageId: "not-a-page-id",
        graphVersion: "v99.0",
        userAccessToken: "user-token",
        appId: "app-1",
        appSecret: "app-secret",
        tokenEncryption,
        clientFactory,
      }),
    ).rejects.toThrow("Page ID phải là một dãy số hợp lệ");
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "User token from another Meta App",
      userInspection: { appId: "app-a" },
      code: "FACEBOOK_USER_TOKEN_INVALID",
    },
    {
      name: "Page token from another Meta App",
      pageInspection: { appId: "app-a" },
      code: "FACEBOOK_PAGE_TOKEN_INVALID",
    },
    {
      name: "Page token for another Page",
      pageInspection: { profileId: "99999" },
      code: "FACEBOOK_PAGE_TOKEN_INVALID",
    },
    {
      name: "invalid Page token",
      pageInspection: { isValid: false },
      code: "FACEBOOK_PAGE_TOKEN_INVALID",
    },
  ])("rejects $name", async ({ userInspection, pageInspection, code }) => {
    const userClient = {
      getCurrentUser: vi
        .fn()
        .mockResolvedValue({ id: "facebook-user", name: "Facebook User" }),
      inspectCurrentToken: vi.fn().mockResolvedValue({
        appId: "app-b",
        isValid: true,
        type: "USER",
        userId: "facebook-user",
        scopes: [],
        ...userInspection,
      }),
      getPageCredential: vi.fn().mockResolvedValue({
        externalPageId: "12345",
        name: "Page",
        accessToken: "page-token",
      }),
    };
    const pageClient = {
      inspectCurrentToken: vi.fn().mockResolvedValue({
        appId: "app-b",
        isValid: true,
        type: "PAGE",
        profileId: "12345",
        scopes: [],
        ...pageInspection,
      }),
      probePageReadAccess: vi.fn().mockResolvedValue({
        publishedPosts: true,
        scheduledPosts: true,
      }),
    };

    await expect(
      verifyManualPage({
        pageId: "12345",
        graphVersion: "v26.0",
        userAccessToken: "user-token",
        appId: "app-b",
        appSecret: "app-b-secret",
        tokenEncryption,
        clientFactory: (accessToken) =>
          (accessToken === "user-token" ? userClient : pageClient) as never,
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects a Page response whose ID differs from the selected Page", async () => {
    const userClient = {
      getCurrentUser: vi
        .fn()
        .mockResolvedValue({ id: "facebook-user", name: "Facebook User" }),
      inspectCurrentToken: vi.fn().mockResolvedValue({
        appId: "app-b",
        isValid: true,
        type: "USER",
        userId: "facebook-user",
        scopes: [],
      }),
      getPageCredential: vi.fn().mockResolvedValue({
        externalPageId: "99999",
        name: "Wrong Page",
        accessToken: "page-token",
      }),
    };

    await expect(
      verifyManualPage({
        pageId: "12345",
        graphVersion: "v26.0",
        userAccessToken: "user-token",
        appId: "app-b",
        appSecret: "app-b-secret",
        tokenEncryption,
        clientFactory: () => userClient as never,
      }),
    ).rejects.toMatchObject({ code: "FACEBOOK_PAGE_ID_MISMATCH" });
  });
});
