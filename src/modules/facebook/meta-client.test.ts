import { describe, expect, it, vi } from "vitest";
import { MetaGraphClient } from "./meta-client";

describe("MetaGraphClient", () => {
  it("keeps the access token in the authorization header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          {
            id: "page-1",
            name: "Page One",
            access_token: "page-token",
            tasks: [],
          },
        ],
      }),
    );
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "user-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    const result = await client.getManagedPages();
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(String(url)).not.toContain("user-token");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer user-token",
    );
    expect(result.pages[0]?.accessToken).toBe("page-token");
  });

  it("creates a Facebook-native schedule", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "post-1" }));
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    const remoteId = await client.scheduleText(
      "page-1",
      "Scheduled caption",
      new Date("2026-08-21T02:00:00.000Z"),
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = init?.body as URLSearchParams;

    expect(remoteId).toBe("post-1");
    expect(body.get("published")).toBe("false");
    expect(body.get("scheduled_publish_time")).toBe("1787277600");
  });

  it("normalizes token errors without returning the provider message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: 190,
            message: "Provider details that should not escape",
          },
        },
        { status: 400 },
      ),
    );
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "bad-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    await expect(client.getManagedPages()).rejects.toMatchObject({
      code: "FACEBOOK_PERMISSION_DENIED",
      message: "Facebook token không còn đủ quyền cho thao tác này.",
      retryable: false,
    });
  });

  it("reads published posts without exposing provider next URLs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          {
            id: "page-1_post-1",
            message: "Published caption",
            is_published: true,
          },
        ],
        paging: {
          cursors: { after: "safe-cursor" },
          next: "https://graph.test/page-1/posts?access_token=must-not-escape",
        },
      }),
    );
    const client = new MetaGraphClient({
      graphVersion: "99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    const result = await client.getPublishedPosts("page-1");

    expect(result.posts[0]?.id).toBe("page-1_post-1");
    expect(result.after).toBe("safe-cursor");
    expect(JSON.stringify(result)).not.toContain("access_token");
  });

  it("reschedules and cancels an existing scheduled post", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    await client.reschedulePost(
      "page-1_post-1",
      new Date("2026-08-22T02:00:00.000Z"),
    );
    await client.cancelScheduledPost("page-1_post-1");

    const [, rescheduleInit] = fetchMock.mock.calls[0] ?? [];
    const [cancelUrl, cancelInit] = fetchMock.mock.calls[1] ?? [];
    expect(
      (rescheduleInit?.body as URLSearchParams).get("scheduled_publish_time"),
    ).toBe("1787364000");
    expect(cancelInit?.method).toBe("DELETE");
    expect(String(cancelUrl)).toContain("page-1_post-1");
  });
});
