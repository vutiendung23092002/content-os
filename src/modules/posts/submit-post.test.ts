import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import {
  SubmitPostService,
  type PreparedSubmission,
  type SubmissionMetaClient,
  type SubmissionPersistence,
} from "./submit-post";

const postId = "018f0d44-35f0-7b63-99d2-c1b9222cd05d";
const prepared: PreparedSubmission = {
  operationId: "operation-1",
  postId,
  pageId: "page-local-1",
  externalPageId: "page-external-1",
  message: "Caption",
  pageAccessToken: "decrypted-page-token",
};

function setup() {
  const persistence: SubmissionPersistence = {
    prepare: vi.fn().mockResolvedValue(prepared),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const client: SubmissionMetaClient = {
    publishText: vi.fn().mockResolvedValue("remote-post-1"),
    scheduleText: vi.fn().mockResolvedValue("remote-scheduled-1"),
  };
  const clientFactory = vi.fn().mockReturnValue(client);
  const service = new SubmitPostService(
    persistence,
    clientFactory,
    () => new Date("2026-08-20T00:00:00.000Z"),
  );
  return { persistence, client, clientFactory, service };
}

describe("SubmitPostService", () => {
  it("publishes with the decrypted Page token and records remote success", async () => {
    const setupResult = setup();
    const result = await setupResult.service.publish(postId);

    expect(setupResult.clientFactory).toHaveBeenCalledWith(
      "decrypted-page-token",
    );
    expect(setupResult.client.publishText).toHaveBeenCalledWith(
      "page-external-1",
      "Caption",
    );
    expect(setupResult.persistence.succeed).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePostId: "remote-post-1",
        kind: "publish_now",
      }),
    );
    expect(result.status).toBe("published");
  });

  it("creates a native schedule and stores its exact UTC time", async () => {
    const setupResult = setup();
    const scheduledFor = "2026-08-21T02:00:00.000Z";
    const result = await setupResult.service.schedule(postId, scheduledFor);

    expect(setupResult.client.scheduleText).toHaveBeenCalledWith(
      "page-external-1",
      "Caption",
      new Date(scheduledFor),
    );
    expect(setupResult.persistence.succeed).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "schedule",
        scheduledFor: new Date(scheduledFor),
      }),
    );
    expect(result.status).toBe("scheduled");
  });

  it("marks an ambiguous provider timeout uncertain and never retries", async () => {
    const setupResult = setup();
    vi.mocked(setupResult.client.publishText).mockRejectedValue(
      new AppError({
        code: "FACEBOOK_NETWORK_ERROR",
        message: "Không thể kết nối Meta Graph API.",
        retryable: true,
      }),
    );

    await expect(setupResult.service.publish(postId)).rejects.toMatchObject({
      code: "FACEBOOK_NETWORK_ERROR",
    });
    expect(setupResult.client.publishText).toHaveBeenCalledTimes(1);
    expect(setupResult.persistence.fail).toHaveBeenCalledWith(
      expect.objectContaining({ uncertain: true }),
    );
  });

  it("marks a known permission rejection failed", async () => {
    const setupResult = setup();
    vi.mocked(setupResult.client.publishText).mockRejectedValue(
      new AppError({
        code: "FACEBOOK_PERMISSION_DENIED",
        message: "Facebook token không còn đủ quyền cho thao tác này.",
        status: 403,
      }),
    );

    await expect(setupResult.service.publish(postId)).rejects.toMatchObject({
      code: "FACEBOOK_PERMISSION_DENIED",
    });
    expect(setupResult.persistence.fail).toHaveBeenCalledWith(
      expect.objectContaining({ uncertain: false }),
    );
  });

  it("rejects a past schedule before creating an operation", async () => {
    const setupResult = setup();

    await expect(
      setupResult.service.schedule(postId, "2026-08-19T02:00:00.000Z"),
    ).rejects.toMatchObject({ code: "SCHEDULE_TIME_INVALID" });
    expect(setupResult.persistence.prepare).not.toHaveBeenCalled();
  });

  it("does not mark the post failed when Meta succeeded but the local commit failed", async () => {
    const setupResult = setup();
    vi.mocked(setupResult.persistence.succeed).mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(setupResult.service.publish(postId)).rejects.toMatchObject({
      code: "REMOTE_SUCCESS_LOCAL_PERSIST_FAILED",
    });
    expect(setupResult.persistence.fail).not.toHaveBeenCalled();
    expect(setupResult.client.publishText).toHaveBeenCalledTimes(1);
  });
});
