import { describe, expect, it, vi } from "vitest";
import {
  assertDesignatedTestPage,
  cleanupPendingArtifacts,
  createSmokeArtifactWithRecovery,
  resolveSmokeExitCode,
  type CapabilityPostPage,
  type CapabilityReadClient,
  type SmokeArtifact,
} from "./meta-capability-smoke-core";

const target = {
  pageId: "test-page-123",
  expectedPageName: "Han Content Test",
  graphVersion: "v26.0",
  confirmedGraphVersion: "v26.0",
  designatedPageId: "test-page-123",
  designatedPageName: "Han Content Test",
  pinnedGraphVersion: "v26.0",
};

function readClient(input?: {
  published?: CapabilityPostPage;
  scheduled?: CapabilityPostPage;
}): CapabilityReadClient {
  return {
    getPublishedPosts: vi.fn().mockResolvedValue(
      input?.published ?? {
        posts: [],
      },
    ),
    getScheduledPosts: vi.fn().mockResolvedValue(
      input?.scheduled ?? {
        posts: [],
      },
    ),
  };
}

describe("Meta capability designated test Page guard", () => {
  it("accepts the exact configured test Page and pinned version", () => {
    expect(() => assertDesignatedTestPage(target)).not.toThrow();
  });

  it("rejects a Page ID other than the designated test Page", () => {
    expect(() =>
      assertDesignatedTestPage({ ...target, pageId: "production-page" }),
    ).toThrowError(
      expect.objectContaining({ code: "DESIGNATED_TEST_PAGE_ID_MISMATCH" }),
    );
  });

  it("rejects a Page name other than the designated test Page name", () => {
    expect(() =>
      assertDesignatedTestPage({
        ...target,
        expectedPageName: "Production Page",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "DESIGNATED_TEST_PAGE_NAME_MISMATCH" }),
    );
  });

  it("fails closed when the designated Page environment is missing", () => {
    expect(() =>
      assertDesignatedTestPage({
        ...target,
        designatedPageId: undefined,
        designatedPageName: undefined,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "DESIGNATED_TEST_PAGE_NOT_CONFIGURED",
      }),
    );
  });

  it("rejects a Graph version mismatch", () => {
    expect(() =>
      assertDesignatedTestPage({ ...target, graphVersion: "v25.0" }),
    ).toThrowError(
      expect.objectContaining({ code: "GRAPH_VERSION_CONFIRMATION_MISMATCH" }),
    );
  });
});

describe("Meta capability unknown create outcome recovery", () => {
  const exactMessage =
    "HAN-CONTENT-CAPABILITY-2026-08-31T00:00:00.000Z-run12345 plain-text publish smoke";
  const unknownOutcome = Object.assign(new Error("request timed out"), {
    code: "FACEBOOK_NETWORK_ERROR",
    retryable: true,
  });

  it("recovers one exact marker match and cleans the recovered artifact", async () => {
    const client = readClient({
      published: {
        posts: [
          { id: "unrelated-post", message: "ordinary Page content" },
          { id: "recovered-post", message: exactMessage },
        ],
      },
    });
    const create = vi.fn().mockRejectedValue(unknownOutcome);
    const artifacts: SmokeArtifact[] = [];

    const artifact = await createSmokeArtifactWithRecovery({
      client,
      pageId: target.pageId,
      remoteKind: "published",
      artifactKind: "plain_text_publish",
      exactMessage,
      create,
      artifacts,
      recoveryAttempts: 1,
    });
    const cleanupClient = { deletePost: vi.fn().mockResolvedValue(undefined) };
    const cleanupSucceeded = await cleanupPendingArtifacts(
      cleanupClient,
      artifacts,
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(artifact).toMatchObject({
      remotePostId: "recovered-post",
      recoveredRemoteSuccess: true,
      cleanup: "succeeded",
    });
    expect(cleanupSucceeded).toBe(true);
    expect(cleanupClient.deletePost).toHaveBeenCalledTimes(1);
    expect(cleanupClient.deletePost).toHaveBeenCalledWith("recovered-post");
    expect(cleanupClient.deletePost).not.toHaveBeenCalledWith("unrelated-post");
  });

  it("fails unresolved without blindly retrying when no marker matches", async () => {
    const client = readClient({
      published: {
        posts: [{ id: "unrelated-post", message: "ordinary Page content" }],
      },
    });
    const create = vi.fn().mockRejectedValue(unknownOutcome);
    const artifacts: SmokeArtifact[] = [];

    await expect(
      createSmokeArtifactWithRecovery({
        client,
        pageId: target.pageId,
        remoteKind: "published",
        artifactKind: "plain_text_publish",
        exactMessage,
        create,
        artifacts,
        recoveryAttempts: 1,
      }),
    ).rejects.toMatchObject({ code: "REMOTE_CREATE_OUTCOME_UNRESOLVED" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(artifacts).toEqual([]);
  });

  it("reports ambiguity and does not delete any candidate", async () => {
    const client = readClient({
      published: {
        posts: [
          { id: "candidate-1", message: exactMessage },
          { id: "candidate-2", message: exactMessage },
        ],
      },
    });
    const create = vi.fn().mockRejectedValue(unknownOutcome);
    const artifacts: SmokeArtifact[] = [];

    await expect(
      createSmokeArtifactWithRecovery({
        client,
        pageId: target.pageId,
        remoteKind: "published",
        artifactKind: "plain_text_publish",
        exactMessage,
        create,
        artifacts,
        recoveryAttempts: 1,
      }),
    ).rejects.toMatchObject({ code: "REMOTE_CREATE_OUTCOME_AMBIGUOUS" });

    const cleanupClient = { deletePost: vi.fn() };
    await cleanupPendingArtifacts(cleanupClient, artifacts);
    expect(create).toHaveBeenCalledTimes(1);
    expect(cleanupClient.deletePost).not.toHaveBeenCalled();
  });

  it("returns a non-zero result when cleanup fails", async () => {
    const artifacts: SmokeArtifact[] = [
      {
        kind: "plain_text_publish",
        remotePostId: "smoke-post",
        created: true,
        verified: true,
        cleanup: "pending",
        recoveredRemoteSuccess: false,
      },
    ];
    const cleanupSucceeded = await cleanupPendingArtifacts(
      { deletePost: vi.fn().mockRejectedValue(new Error("cleanup failed")) },
      artifacts,
    );

    expect(cleanupSucceeded).toBe(false);
    expect(artifacts[0]?.cleanup).toBe("failed");
    expect(
      resolveSmokeExitCode({ requestedExitCode: 0, cleanupSucceeded }),
    ).toBe(1);
  });
});
