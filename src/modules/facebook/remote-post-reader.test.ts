import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import {
  RemotePostReader,
  type RemotePostAccess,
  type RemotePostMetaClient,
} from "./remote-post-reader";

const localPageId = "2f6707b7-8594-4d33-b60f-18bdb4f826ac";
const pageCredential = {
  ciphertext: Buffer.from("ciphertext"),
  nonce: Buffer.alloc(12),
  authTag: Buffer.alloc(16),
  keyVersion: 1,
  fingerprint: "fingerprint",
};

function createSetup() {
  const access: RemotePostAccess = {
    loadForActor: vi.fn().mockResolvedValue({
      page: {
        id: localPageId,
        externalPageId: "page-123",
        name: "Page Test",
        avatarUrl: null,
        timezone: "Asia/Ho_Chi_Minh",
      },
      pageCredential,
    }),
    loadAdminManaged: vi.fn().mockResolvedValue({
      page: {
        id: localPageId,
        externalPageId: "page-123",
        name: "Page Test",
        avatarUrl: null,
        timezone: "Asia/Ho_Chi_Minh",
      },
      pageCredential,
    }),
  };
  const client: RemotePostMetaClient = {
    getPublishedPosts: vi.fn().mockResolvedValue({
      posts: [
        {
          id: "page-123_post-1",
          message: "Bài đã đăng",
          created_time: "2026-08-21T02:00:00+0000",
          permalink_url: "https://www.facebook.com/page-123/posts/post-1",
          full_picture: "https://images.test/post-1.jpg",
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
                        image: { src: "https://images.test/post-1-a.jpg" },
                      },
                    },
                    {
                      media_type: "photo",
                      media: {
                        image: { src: "https://images.test/post-1-b.jpg" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      after: "next-page",
    }),
    getScheduledPosts: vi.fn().mockResolvedValue({
      posts: [
        {
          id: "page-123_post-2",
          message: "Bài hẹn giờ",
          scheduled_publish_time: "1787364000",
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
                        image: { src: "https://images.test/scheduled-1.jpg" },
                      },
                    },
                    {
                      media_type: "photo",
                      media: {
                        image: { src: "https://images.test/scheduled-2.jpg" },
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
  };
  const clientFactory = vi.fn().mockReturnValue(client);
  const incidentRecorder = vi.fn().mockResolvedValue(undefined);

  return {
    access,
    client,
    clientFactory,
    incidentRecorder,
    reader: new RemotePostReader(access, clientFactory, incidentRecorder),
  };
}

describe("RemotePostReader", () => {
  it("locks the Page when a read confirms an invalid credential", async () => {
    const setup = createSetup();
    vi.mocked(setup.client.getPublishedPosts).mockRejectedValue(
      new AppError({
        code: "FACEBOOK_TOKEN_INVALID",
        message: "Facebook Page token đã hết hạn hoặc bị thu hồi.",
        status: 403,
      }),
    );

    await expect(
      setup.reader.list({ localPageId, kind: "published" }),
    ).rejects.toMatchObject({ code: "FACEBOOK_TOKEN_INVALID" });
    expect(setup.incidentRecorder).toHaveBeenCalledWith({
      pageId: localPageId,
      status: "revoked",
      errorCode: "FACEBOOK_TOKEN_INVALID",
    });
  });

  it("returns a safe published-post DTO and passes only the remote Page ID", async () => {
    const setup = createSetup();
    const result = await setup.reader.list({
      localPageId,
      kind: "published",
    });

    expect(setup.access.loadAdminManaged).toHaveBeenCalledWith(localPageId);
    expect(setup.access.loadForActor).not.toHaveBeenCalled();
    expect(setup.clientFactory).toHaveBeenCalledWith(pageCredential);
    expect(setup.client.getPublishedPosts).toHaveBeenCalledWith(
      "page-123",
      undefined,
    );
    expect(result.posts[0]).toMatchObject({
      remoteId: "page-123_post-1",
      kind: "published",
      effectiveAt: "2026-08-21T02:00:00.000Z",
      engagement: { reactions: 12, comments: 4, shares: 2 },
      imageUrl: "https://images.test/post-1-a.jpg",
      imageUrls: [
        "https://images.test/post-1-a.jpg",
        "https://images.test/post-1-b.jpg",
      ],
      mediaType: "image",
      remoteMediaIds: [],
      source: "facebook",
    });
    expect(result.after).toBe("next-page");
    expect(JSON.stringify(result)).not.toContain("secret-page-token");
  });

  it("uses the actor-specific credential path only when an actor exists", async () => {
    const setup = createSetup();
    await setup.reader.list({
      localPageId,
      kind: "published",
      actorUserId: "11111111-1111-4111-8111-111111111111",
    });

    expect(setup.access.loadForActor).toHaveBeenCalledWith(
      localPageId,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(setup.access.loadAdminManaged).not.toHaveBeenCalled();
  });

  it("keeps the video object id exposed by a published attachment target", async () => {
    const setup = createSetup();
    vi.mocked(setup.client.getPublishedPosts).mockResolvedValue({
      posts: [
        {
          id: "page-123_feed-post-1",
          message: "Video post",
          created_time: "2026-08-21T02:00:00+0000",
          attachments: {
            data: [
              {
                media_type: "video_inline",
                target: { id: "video-object-1" },
              },
            ],
          },
        },
      ],
      after: undefined,
    });

    const result = await setup.reader.list({
      localPageId,
      kind: "published",
    });

    expect(result.posts[0]).toMatchObject({
      remoteId: "page-123_feed-post-1",
      mediaType: "video",
      remoteMediaIds: ["video-object-1"],
    });
  });

  it("normalizes a Unix scheduled time without calling a mutation method", async () => {
    const setup = createSetup();
    const result = await setup.reader.list({
      localPageId,
      kind: "scheduled",
      after: "cursor-1",
    });

    expect(setup.client.getScheduledPosts).toHaveBeenCalledWith(
      "page-123",
      "cursor-1",
    );
    expect(result.posts[0]).toMatchObject({
      kind: "scheduled",
      effectiveAt: "2026-08-22T02:00:00.000Z",
      engagement: null,
      imageUrl: "https://images.test/scheduled-1.jpg",
      imageUrls: [
        "https://images.test/scheduled-1.jpg",
        "https://images.test/scheduled-2.jpg",
      ],
      mediaType: "image",
      remoteMediaIds: [],
    });
    expect(setup.client.getPublishedPosts).not.toHaveBeenCalled();
  });
});
