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

  it("publishes a hosted Page video through the videos edge", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "video-1" }));
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    const remoteId = await client.publishVideo({
      pageId: "page-1",
      description: "Video caption",
      fileUrl: "https://signed/video.mp4",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = init?.body as URLSearchParams;

    expect(remoteId).toBe("video-1");
    expect(String(url)).toBe("https://graph.test/v99.0/page-1/videos");
    expect(body.get("description")).toBe("Video caption");
    expect(body.get("file_url")).toBe("https://signed/video.mp4");
    expect(body.has("published")).toBe(false);
  });

  it("creates a Facebook-native Page video schedule", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "video-2" }));
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    await client.scheduleVideo({
      pageId: "page-1",
      description: "Scheduled video",
      fileUrl: "https://signed/video.mp4",
      scheduledFor: new Date("2026-08-21T02:00:00.000Z"),
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = init?.body as URLSearchParams;

    expect(body.get("published")).toBe("false");
    expect(body.get("scheduled_publish_time")).toBe("1787277600");
  });

  it("uploads photos without publishing and preserves their order in one feed post", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "photo-1" }))
      .mockResolvedValueOnce(Response.json({ id: "photo-2" }))
      .mockResolvedValueOnce(Response.json({ id: "post-1" }));
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    const receipt = await client.publishPost({
      pageId: "page-1",
      message: "Gallery caption",
      mediaUrls: ["https://signed/one.jpg", "https://signed/two.jpg"],
    });

    expect(receipt).toEqual({
      remotePostId: "post-1",
      remoteMediaIds: ["photo-1", "photo-2"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] ?? [];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] ?? [];
    const [feedUrl, feedInit] = fetchMock.mock.calls[2] ?? [];
    expect(String(firstUrl)).toContain("page-1/photos");
    expect((firstInit?.body as URLSearchParams).get("published")).toBe("false");
    expect((firstInit?.body as URLSearchParams).get("url")).toBe(
      "https://signed/one.jpg",
    );
    expect(String(secondUrl)).toContain("page-1/photos");
    expect((secondInit?.body as URLSearchParams).get("url")).toBe(
      "https://signed/two.jpg",
    );
    expect(String(feedUrl)).toContain("page-1/feed");
    expect((feedInit?.body as URLSearchParams).get("attached_media")).toBe(
      JSON.stringify([{ media_fbid: "photo-1" }, { media_fbid: "photo-2" }]),
    );
  });

  it("creates one native scheduled feed post for ordered photos", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "photo-1" }))
      .mockResolvedValueOnce(Response.json({ id: "photo-2" }))
      .mockResolvedValueOnce(Response.json({ id: "scheduled-post-1" }));
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    const receipt = await client.schedulePost({
      pageId: "page-1",
      message: "Scheduled gallery",
      mediaUrls: ["https://signed/one.jpg", "https://signed/two.jpg"],
      scheduledFor: new Date("2026-08-21T02:00:00.000Z"),
    });

    expect(receipt).toEqual({
      remotePostId: "scheduled-post-1",
      remoteMediaIds: ["photo-1", "photo-2"],
    });
    const [feedUrl, feedInit] = fetchMock.mock.calls[2] ?? [];
    const body = feedInit?.body as URLSearchParams;
    expect(String(feedUrl)).toBe("https://graph.test/v99.0/page-1/feed");
    expect(body.get("published")).toBe("false");
    expect(body.get("scheduled_publish_time")).toBe("1787277600");
    expect(body.get("attached_media")).toBe(
      JSON.stringify([{ media_fbid: "photo-1" }, { media_fbid: "photo-2" }]),
    );
  });

  it("stops before creating the feed post when Meta cannot fetch one photo", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "photo-1" }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 2, message: "Provider media fetch failed" } },
          { status: 502 },
        ),
      );
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });

    await expect(
      client.publishPost({
        pageId: "page-1",
        message: "Gallery",
        mediaUrls: ["https://signed/one.jpg", "https://signed/two.jpg"],
      }),
    ).rejects.toMatchObject({
      code: "FACEBOOK_API_ERROR",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/page-1/feed"),
      ),
    ).toBe(false);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain("page-token");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer page-token",
      );
    }
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

  it("bounds published posts to a requested time window", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [] }));
    const client = new MetaGraphClient({
      graphVersion: "v99.0",
      accessToken: "page-token",
      baseUrl: "https://graph.test",
      fetch: fetchMock,
    });
    const since = new Date("2026-08-17T00:00:00+07:00");
    const until = new Date("2026-08-24T00:00:00+07:00");

    await client.getPublishedPosts("page-1", undefined, 100, { since, until });
    const [url] = fetchMock.mock.calls[0] ?? [];
    const query = new URL(String(url)).searchParams;

    expect(query.get("limit")).toBe("100");
    expect(query.get("since")).toBe(String(Math.floor(since.getTime() / 1000)));
    expect(query.get("until")).toBe(String(Math.floor(until.getTime() / 1000)));
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
            full_picture: "https://images.test/scheduled-cover.jpg",
            attachments: {
              data: [
                {
                  media_type: "album",
                  subattachments: {
                    data: [
                      {
                        media_type: "photo",
                        media: {
                          image: {
                            src: "https://images.test/scheduled-1.jpg",
                          },
                        },
                      },
                      {
                        media_type: "photo",
                        media: {
                          image: {
                            src: "https://images.test/scheduled-2.jpg",
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
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
    expect(
      result.posts[0]?.attachments?.data[0]?.subattachments?.data,
    ).toHaveLength(2);
    expect(new URL(String(url)).searchParams.get("limit")).toBe("100");
    expect(new URL(String(url)).searchParams.get("fields")).toContain(
      "attachments{media_type,media,subattachments.limit(10){media_type,media}}",
    );
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
