export type CapabilityRemotePostKind = "published" | "scheduled";

export type CapabilityRemotePost = {
  id: string;
  message?: string;
  scheduled_publish_time?: string | number;
};

export type CapabilityPostPage = {
  posts: CapabilityRemotePost[];
  after?: string;
};

export type CapabilityReadClient = {
  getPublishedPosts(
    pageId: string,
    after?: string,
    limit?: number,
  ): Promise<CapabilityPostPage>;
  getScheduledPosts(
    pageId: string,
    after?: string,
    limit?: number,
  ): Promise<CapabilityPostPage>;
};

export type CapabilityCleanupClient = {
  deletePost(remotePostId: string): Promise<void>;
};

export type SmokeArtifact = {
  kind: "plain_text_publish" | "native_text_schedule";
  remotePostId: string;
  created: true;
  verified: boolean;
  rescheduled?: boolean;
  cleanup: "succeeded" | "failed" | "pending";
  recoveredRemoteSuccess: boolean;
};

export class CapabilitySmokeSafetyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CapabilitySmokeSafetyError";
    this.code = code;
  }
}

export function assertDesignatedTestPage(input: {
  pageId: string;
  expectedPageName: string;
  graphVersion: string;
  confirmedGraphVersion: string;
  designatedPageId?: string;
  designatedPageName?: string;
  pinnedGraphVersion: string;
  forceRequested?: boolean;
}): void {
  const designatedPageId = input.designatedPageId?.trim();
  const designatedPageName = input.designatedPageName?.trim();

  if (!designatedPageId || !designatedPageName) {
    throw new CapabilitySmokeSafetyError(
      "DESIGNATED_TEST_PAGE_NOT_CONFIGURED",
      "The designated Meta capability test Page is not configured.",
    );
  }

  if (input.forceRequested) {
    throw new CapabilitySmokeSafetyError(
      "FORCE_BYPASS_NOT_SUPPORTED",
      "The Meta capability smoke guard cannot be bypassed.",
    );
  }

  if (input.pageId !== designatedPageId) {
    throw new CapabilitySmokeSafetyError(
      "DESIGNATED_TEST_PAGE_ID_MISMATCH",
      "The requested Page ID is not the designated capability test Page.",
    );
  }

  if (input.expectedPageName !== designatedPageName) {
    throw new CapabilitySmokeSafetyError(
      "DESIGNATED_TEST_PAGE_NAME_MISMATCH",
      "The expected Page name is not the designated capability test Page name.",
    );
  }

  if (
    input.graphVersion !== input.pinnedGraphVersion ||
    input.confirmedGraphVersion !== input.pinnedGraphVersion ||
    input.confirmedGraphVersion !== input.graphVersion
  ) {
    throw new CapabilitySmokeSafetyError(
      "GRAPH_VERSION_CONFIRMATION_MISMATCH",
      "The configured, confirmed, and pinned Graph API versions must match.",
    );
  }
}

async function readPostPage(
  client: CapabilityReadClient,
  pageId: string,
  kind: CapabilityRemotePostKind,
  after?: string,
): Promise<CapabilityPostPage> {
  return kind === "published"
    ? client.getPublishedPosts(pageId, after, 100)
    : client.getScheduledPosts(pageId, after, 100);
}

export async function findRemotePosts(input: {
  client: CapabilityReadClient;
  pageId: string;
  kind: CapabilityRemotePostKind;
  matches: (post: CapabilityRemotePost) => boolean;
  maxPages?: number;
}): Promise<{
  matches: CapabilityRemotePost[];
  paginationObserved: boolean;
}> {
  const maxPages = input.maxPages ?? 10;
  const matches: CapabilityRemotePost[] = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;
  let paginationObserved = false;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await readPostPage(
      input.client,
      input.pageId,
      input.kind,
      after,
    );
    matches.push(...page.posts.filter(input.matches));

    if (!page.after) {
      return { matches, paginationObserved };
    }

    paginationObserved = true;
    if (seenCursors.has(page.after)) {
      throw new CapabilitySmokeSafetyError(
        "REMOTE_PAGINATION_CURSOR_REPEATED",
        "Remote pagination repeated a cursor; the result is unsafe to use.",
      );
    }

    seenCursors.add(page.after);
    after = page.after;
  }

  throw new CapabilitySmokeSafetyError(
    "REMOTE_PAGINATION_LIMIT_EXCEEDED",
    "Remote pagination exceeded the smoke tool safety bound.",
  );
}

export async function findRemotePostById(input: {
  client: CapabilityReadClient;
  pageId: string;
  kind: CapabilityRemotePostKind;
  remotePostId: string;
}): Promise<{
  post?: CapabilityRemotePost;
  paginationObserved: boolean;
}> {
  let after: string | undefined;
  let paginationObserved = false;
  const seenCursors = new Set<string>();

  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await readPostPage(
      input.client,
      input.pageId,
      input.kind,
      after,
    );
    const post = page.posts.find((item) => item.id === input.remotePostId);
    if (post) return { post, paginationObserved };
    if (!page.after) return { paginationObserved };

    paginationObserved = true;
    if (seenCursors.has(page.after)) {
      throw new CapabilitySmokeSafetyError(
        "REMOTE_PAGINATION_CURSOR_REPEATED",
        "Remote pagination repeated a cursor; the result is unsafe to use.",
      );
    }
    seenCursors.add(page.after);
    after = page.after;
  }

  throw new CapabilitySmokeSafetyError(
    "REMOTE_PAGINATION_LIMIT_EXCEEDED",
    "Remote pagination exceeded the smoke tool safety bound.",
  );
}

export function isUnknownCreateOutcome(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; retryable?: unknown };
  return (
    candidate.retryable === true ||
    candidate.code === "FACEBOOK_NETWORK_ERROR" ||
    candidate.code === "FACEBOOK_REQUEST_TIMEOUT"
  );
}

export async function recoverUnknownCreateOutcome(input: {
  client: CapabilityReadClient;
  pageId: string;
  kind: CapabilityRemotePostKind;
  exactMessage: string;
  attempts?: number;
  wait?: () => Promise<void>;
}): Promise<CapabilityRemotePost> {
  const attempts = input.attempts ?? 3;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await findRemotePosts({
      client: input.client,
      pageId: input.pageId,
      kind: input.kind,
      matches: (post) => post.message === input.exactMessage,
    });

    if (result.matches.length > 1) {
      throw new CapabilitySmokeSafetyError(
        "REMOTE_CREATE_OUTCOME_AMBIGUOUS",
        "Multiple exact smoke marker matches were found; no remote ID was selected.",
      );
    }

    if (result.matches.length === 1) {
      return result.matches[0];
    }

    if (attempt + 1 < attempts && input.wait) {
      await input.wait();
    }
  }

  throw new CapabilitySmokeSafetyError(
    "REMOTE_CREATE_OUTCOME_UNRESOLVED",
    "No exact smoke marker match was found; the remote outcome remains unresolved.",
  );
}

export async function createSmokeArtifactWithRecovery(input: {
  client: CapabilityReadClient;
  pageId: string;
  remoteKind: CapabilityRemotePostKind;
  artifactKind: SmokeArtifact["kind"];
  exactMessage: string;
  create: () => Promise<string>;
  artifacts: SmokeArtifact[];
  recoveryAttempts?: number;
  recoveryWait?: () => Promise<void>;
}): Promise<SmokeArtifact> {
  let id: string;
  let recoveredRemoteSuccess = false;

  try {
    id = await input.create();
  } catch (error) {
    if (!isUnknownCreateOutcome(error)) {
      throw error;
    }

    const recovered = await recoverUnknownCreateOutcome({
      client: input.client,
      pageId: input.pageId,
      kind: input.remoteKind,
      exactMessage: input.exactMessage,
      attempts: input.recoveryAttempts,
      wait: input.recoveryWait,
    });
    id = recovered.id;
    recoveredRemoteSuccess = true;
  }

  const artifact: SmokeArtifact = {
    kind: input.artifactKind,
    remotePostId: id,
    created: true,
    verified: false,
    cleanup: "pending",
    recoveredRemoteSuccess,
  };
  input.artifacts.push(artifact);
  return artifact;
}

export async function cleanupPendingArtifacts(
  client: CapabilityCleanupClient,
  artifacts: SmokeArtifact[],
  onFailure?: (artifact: SmokeArtifact, error: unknown) => void,
): Promise<boolean> {
  let succeeded = true;

  for (const artifact of artifacts.filter(
    (item) => item.cleanup === "pending",
  )) {
    try {
      await client.deletePost(artifact.remotePostId);
      artifact.cleanup = "succeeded";
    } catch (error) {
      artifact.cleanup = "failed";
      succeeded = false;
      onFailure?.(artifact, error);
    }
  }

  return succeeded;
}

export function resolveSmokeExitCode(input: {
  requestedExitCode: number;
  cleanupSucceeded: boolean;
}): number {
  return input.requestedExitCode === 0 && input.cleanupSucceeded ? 0 : 1;
}
