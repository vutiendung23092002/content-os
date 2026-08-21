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
            picture: {
              data: { url: "https://images.test/page-one.jpg" },
            },
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
    expect(result.pages[0]?.avatarUrl).toBe("https://images.test/page-one.jpg");
    expect(new URL(String(url)).searchParams.get("fields")).toContain(
      "picture.type(small)",
    );
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
            reactions: { summary: { total_count: 12 } },
            comments: { summary: { total_count: 4 } },
            shares: { count: 2 },
            attachments: {
              data: [
                {
                  media_type: "album",
                  subattachments: {
                    data: [
                      {
                        media_type: "photo",
                        media: {
                          image: { src: "https://images.test/photo-1.jpg" },
                        },
                      },
                      {
                        media_type: "photo",
                        media: {
                          image: { src: "https://images.test/photo-2.jpg" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
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
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(result.posts[0]?.id).toBe("page-1_post-1");
    expect(result.posts[0]?.reactions?.summary?.total_count).toBe(12);
    expect(result.posts[0]?.comments?.summary?.total_count).toBe(4);
    expect(result.posts[0]?.shares?.count).toBe(2);
    expect(
      result.posts[0]?.attachments?.data[0]?.subattachments?.data,
    ).toHaveLength(2);
    expect(result.after).toBe("safe-cursor");
    expect(JSON.stringify(result)).not.toContain("access_token");
    expect(new URL(String(url)).searchParams.get("limit")).toBe("50");
    expect(new URL(String(url)).searchParams.get("fields")).toContain(
      "full_picture",
    );
    expect(new URL(String(url)).searchParams.get("fields")).toContain(
      "reactions.limit(0).summary(true)",
    );
    expect(new URL(String(url)).searchParams.get("fields")).toContain(
      "attachments{media_type,media,subattachments.limit(10){media_type,media}}",
    );
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("reads scheduled posts with GET and a bounded page size", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          {
            id: "page-1_post-2",
            message: "Scheduled caption",
            scheduled_publish_time: 1_800_000_000,
            is_published: false,
          },
        ],
      }),
    );
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    const result = await client.getScheduledPosts("page-1", undefined, 500);
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(result.posts[0]?.id).toBe("page-1_post-2");
    expect(new URL(String(url)).searchParams.get("limit")).toBe("100");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
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
