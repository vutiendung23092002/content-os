import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import {
  ReschedulePostService,
  type PreparedReschedule,
  type RescheduleMetaClient,
  type ReschedulePersistence,
} from "./reschedule-post";

const postId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";
const desired = "2026-08-21T02:00:00.000Z";
const prepared: PreparedReschedule = {
  operationId: "operation-1",
  postId,
  pageId: "page-local-1",
  externalPageId: "page-external-1",
  remotePostId: "remote-post-1",
  previousScheduledFor: new Date("2026-08-21T01:00:00.000Z"),
  pageAccessToken: "decrypted-token",
};

function unix(value: string) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function setup() {
  const persistence: ReschedulePersistence = {
    prepare: vi.fn().mockResolvedValue(prepared),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    uncertain: vi.fn().mockResolvedValue(undefined),
  };
  const client: RescheduleMetaClient = {
    getScheduledPosts: vi
      .fn()
      .mockResolvedValueOnce({
        posts: [
          {
            id: prepared.remotePostId,
            scheduled_publish_time: unix(
              prepared.previousScheduledFor.toISOString(),
            ),
          },
        ],
      })
      .mockResolvedValue({
        posts: [
          {
            id: prepared.remotePostId,
            scheduled_publish_time: unix(desired),
          },
        ],
      }),
    reschedulePost: vi.fn().mockResolvedValue(undefined),
  };
  const clientFactory = vi.fn().mockReturnValue(client);
  const service = new ReschedulePostService(
    persistence,
    clientFactory,
    () => new Date("2026-08-20T00:00:00.000Z"),
  );
  return { persistence, client, clientFactory, service };
}

describe("ReschedulePostService", () => {
  it("changes a remote schedule once and persists only after readback", async () => {
    const context = setup();

    await expect(context.service.reschedule(postId, desired)).resolves.toEqual({
      operationId: "operation-1",
      postId,
      remotePostId: "remote-post-1",
      status: "scheduled",
      scheduledFor: desired,
    });
    expect(context.clientFactory).toHaveBeenCalledWith("decrypted-token");
    expect(context.client.reschedulePost).toHaveBeenCalledTimes(1);
    expect(context.client.reschedulePost).toHaveBeenCalledWith(
      "remote-post-1",
      new Date(desired),
    );
    expect(context.persistence.succeed).toHaveBeenCalledOnce();
  });

  it("validates the schedule window before creating an operation", async () => {
    const context = setup();
    await expect(
      context.service.reschedule(postId, "2026-08-20T00:19:00.000Z"),
    ).rejects.toMatchObject({ code: "SCHEDULE_TIME_OUT_OF_RANGE" });
    expect(context.persistence.prepare).not.toHaveBeenCalled();
  });

  it("does not call Facebook when persistence reports an already published post", async () => {
    const context = setup();
    vi.mocked(context.persistence.prepare).mockRejectedValue(
      new AppError({
        code: "POST_ALREADY_PUBLISHED",
        message: "Bài viết đã đăng nên không thể đổi lịch.",
        status: 409,
      }),
    );

    await expect(
      context.service.reschedule(postId, desired),
    ).rejects.toMatchObject({ code: "POST_ALREADY_PUBLISHED" });
    expect(context.clientFactory).not.toHaveBeenCalled();
    expect(context.client.reschedulePost).not.toHaveBeenCalled();
  });

  it("does not mutate when the remote scheduled post is missing", async () => {
    const context = setup();
    vi.mocked(context.client.getScheduledPosts).mockReset();
    vi.mocked(context.client.getScheduledPosts).mockResolvedValue({
      posts: [],
    });

    await expect(
      context.service.reschedule(postId, desired),
    ).rejects.toMatchObject({ code: "REMOTE_SCHEDULE_NOT_FOUND" });
    expect(context.client.reschedulePost).not.toHaveBeenCalled();
    expect(context.persistence.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "REMOTE_SCHEDULE_NOT_FOUND" }),
    );
  });

  it("records a known permission rejection as failed", async () => {
    const context = setup();
    vi.mocked(context.client.reschedulePost).mockRejectedValue(
      new AppError({
        code: "FACEBOOK_PERMISSION_DENIED",
        message: "Facebook token không còn đủ quyền.",
        status: 403,
      }),
    );

    await expect(
      context.service.reschedule(postId, desired),
    ).rejects.toMatchObject({ code: "FACEBOOK_PERMISSION_DENIED" });
    expect(context.persistence.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "FACEBOOK_PERMISSION_DENIED" }),
    );
    expect(context.persistence.uncertain).not.toHaveBeenCalled();
  });

  it("accepts a timeout when readback confirms the desired schedule", async () => {
    const context = setup();
    vi.mocked(context.client.reschedulePost).mockRejectedValue(
      new AppError({
        code: "FACEBOOK_NETWORK_ERROR",
        message: "Timeout",
        retryable: true,
      }),
    );

    await expect(
      context.service.reschedule(postId, desired),
    ).resolves.toMatchObject({ status: "scheduled", scheduledFor: desired });
    expect(context.client.reschedulePost).toHaveBeenCalledTimes(1);
    expect(context.persistence.succeed).toHaveBeenCalledOnce();
    expect(context.persistence.uncertain).not.toHaveBeenCalled();
  });

  it("marks an unconfirmed timeout uncertain and never retries mutation", async () => {
    const context = setup();
    vi.mocked(context.client.reschedulePost).mockRejectedValue(
      new AppError({
        code: "FACEBOOK_NETWORK_ERROR",
        message: "Timeout",
        retryable: true,
      }),
    );
    vi.mocked(context.client.getScheduledPosts).mockReset();
    vi.mocked(context.client.getScheduledPosts).mockResolvedValue({
      posts: [
        {
          id: prepared.remotePostId,
          scheduled_publish_time: unix(
            prepared.previousScheduledFor.toISOString(),
          ),
        },
      ],
    });

    await expect(
      context.service.reschedule(postId, desired),
    ).rejects.toMatchObject({
      code: "FACEBOOK_RESCHEDULE_UNCERTAIN",
      retryable: false,
    });
    expect(context.client.reschedulePost).toHaveBeenCalledTimes(1);
    expect(context.persistence.uncertain).toHaveBeenCalledOnce();
    expect(context.persistence.succeed).not.toHaveBeenCalled();
  });

  it("marks the operation uncertain when readback fails after Meta succeeds", async () => {
    const context = setup();
    vi.mocked(context.client.getScheduledPosts)
      .mockReset()
      .mockResolvedValueOnce({
        posts: [
          {
            id: prepared.remotePostId,
            scheduled_publish_time: unix(
              prepared.previousScheduledFor.toISOString(),
            ),
          },
        ],
      })
      .mockRejectedValueOnce(new Error("read timeout"));

    await expect(
      context.service.reschedule(postId, desired),
    ).rejects.toMatchObject({
      code: "FACEBOOK_RESCHEDULE_UNCERTAIN",
      retryable: false,
    });
    expect(context.client.reschedulePost).toHaveBeenCalledTimes(1);
    expect(context.persistence.uncertain).toHaveBeenCalledOnce();
    expect(context.persistence.succeed).not.toHaveBeenCalled();
  });

  it("does not label Meta success as failure when local persistence fails", async () => {
    const context = setup();
    vi.mocked(context.persistence.succeed).mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      context.service.reschedule(postId, desired),
    ).rejects.toMatchObject({ code: "REMOTE_SUCCESS_LOCAL_PERSIST_FAILED" });
    expect(context.persistence.fail).not.toHaveBeenCalled();
  });
});
