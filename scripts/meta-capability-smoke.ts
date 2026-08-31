import { randomUUID } from "node:crypto";
import { MetaGraphClient } from "../src/modules/facebook/meta-client";
import {
  MAX_SCHEDULE_AHEAD_DAYS,
  MIN_SCHEDULE_LEAD_MINUTES,
} from "../src/modules/posts/schedule-window";

type VerificationLevel =
  | "VERIFIED_LIVE"
  | "VERIFIED_BY_EXISTING_LIVE_EVIDENCE"
  | "VERIFIED_BY_CONTRACT_TEST"
  | "NOT_LIVE_PROBED";

type RemotePostKind = "published" | "scheduled";

type SmokeArtifact = {
  kind: "plain_text_publish" | "native_text_schedule";
  remotePostId: string;
  created: boolean;
  verified: boolean;
  rescheduled?: boolean;
  cleanup: "succeeded" | "failed" | "pending";
};

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function stableErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return "META_CAPABILITY_SMOKE_FAILED";
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findRemotePost(
  client: MetaGraphClient,
  pageId: string,
  kind: RemotePostKind,
  remotePostId: string,
): Promise<{
  found?: {
    id: string;
    scheduled_publish_time?: string | number;
  };
  paginationObserved: boolean;
  snapshotComplete: boolean;
}> {
  let after: string | undefined;
  let paginationObserved = false;
  const seenCursors = new Set<string>();

  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const result =
      kind === "published"
        ? await client.getPublishedPosts(pageId, after, 100)
        : await client.getScheduledPosts(pageId, after, 100);
    const found = result.posts.find((post) => post.id === remotePostId);
    if (found) return { found, paginationObserved, snapshotComplete: true };
    if (!result.after) {
      return { paginationObserved, snapshotComplete: true };
    }
    if (seenCursors.has(result.after)) {
      return { paginationObserved: true, snapshotComplete: false };
    }
    paginationObserved = true;
    seenCursors.add(result.after);
    after = result.after;
  }

  return { paginationObserved, snapshotComplete: false };
}

async function waitForPostState(input: {
  client: MetaGraphClient;
  pageId: string;
  kind: RemotePostKind;
  remotePostId: string;
  shouldExist: boolean;
  scheduledFor?: Date;
}): Promise<{ matched: boolean; paginationObserved: boolean }> {
  let paginationObserved = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await findRemotePost(
      input.client,
      input.pageId,
      input.kind,
      input.remotePostId,
    );
    paginationObserved ||= result.paginationObserved;
    const exists = Boolean(result.found);
    const scheduledTime = result.found?.scheduled_publish_time;
    const scheduleMatches = input.scheduledFor
      ? scheduledTime !== undefined &&
        Math.abs(Number(scheduledTime) * 1000 - input.scheduledFor.getTime()) <=
          1_000
      : true;
    if (
      result.snapshotComplete &&
      exists === input.shouldExist &&
      (!exists || scheduleMatches)
    ) {
      return { matched: true, paginationObserved };
    }
    if (attempt < 5) await delay(2_000);
  }
  return { matched: false, paginationObserved };
}

const graphVersion = requiredEnvironment("FACEBOOK_GRAPH_API_VERSION");
const userAccessToken = requiredEnvironment("FACEBOOK_USER_ACCESS_TOKEN");
const appId = requiredEnvironment("FACEBOOK_APP_ID");
const appSecret = requiredEnvironment("FACEBOOK_APP_SECRET");
const pageId = argument("page-id");
const expectedPageName = argument("expected-page-name");
const confirmedGraphVersion = argument("confirm-graph-version");
const execute = hasFlag("execute");
const discoveryOnly = hasFlag("discovery-only");

if (
  !pageId ||
  !expectedPageName ||
  confirmedGraphVersion !== "v26.0" ||
  graphVersion !== "v26.0" ||
  execute === discoveryOnly
) {
  console.error(
    JSON.stringify({
      event: "meta_capability_smoke_rejected",
      code: "EXPLICIT_TEST_PAGE_CONFIRMATION_REQUIRED",
      required:
        "--page-id=<id> --expected-page-name=<name> --confirm-graph-version=v26.0 and exactly one of --discovery-only/--execute",
    }),
  );
  process.exit(1);
}

const runAt = new Date();
const marker = `HAN-CONTENT-CAPABILITY-${runAt.toISOString()}-${randomUUID().slice(0, 8)}`;
const userClient = new MetaGraphClient({
  graphVersion,
  accessToken: userAccessToken,
});
const artifacts: SmokeArtifact[] = [];
let pageClient: MetaGraphClient | undefined;
let paginationObserved = false;
let cleanupSucceeded = true;
let report: Record<string, unknown>;
let exitCode = 1;

try {
  const [user, userToken] = await Promise.all([
    userClient.getCurrentUser(),
    userClient.inspectCurrentToken({ appId, appSecret }),
  ]);
  const managedPages = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;
  do {
    const result = await userClient.getManagedPages(after);
    managedPages.push(...result.pages);
    if (!result.after) break;
    if (seenCursors.has(result.after)) throw new Error("PAGE_CURSOR_REPEATED");
    paginationObserved = true;
    seenCursors.add(result.after);
    after = result.after;
  } while (true);

  const discoveredPage = managedPages.find(
    (page) => page.externalPageId === pageId,
  );
  const verifiedPage = await userClient.getPageCredential(pageId);
  if (verifiedPage.name !== expectedPageName) {
    throw new Error("TEST_PAGE_NAME_MISMATCH");
  }
  if (discoveredPage && discoveredPage.name !== expectedPageName) {
    throw new Error("DISCOVERED_TEST_PAGE_NAME_MISMATCH");
  }

  pageClient = new MetaGraphClient({
    graphVersion,
    accessToken: verifiedPage.accessToken,
  });
  const [pageToken, readAccess, publishedRead, scheduledRead] =
    await Promise.all([
      pageClient.inspectCurrentToken({ appId, appSecret }),
      pageClient.probePageReadAccess(pageId),
      pageClient.getPublishedPosts(pageId, undefined, 100),
      pageClient.getScheduledPosts(pageId, undefined, 100),
    ]);
  paginationObserved ||=
    Boolean(publishedRead.after) || Boolean(scheduledRead.after);

  const checks: Record<string, VerificationLevel> = {
    currentUserDiscovery: "VERIFIED_LIVE",
    targetPageVerification: "VERIFIED_LIVE",
    managedPageDiscovery: discoveredPage ? "VERIFIED_LIVE" : "NOT_LIVE_PROBED",
    publishedRead: readAccess.publishedPosts
      ? "VERIFIED_LIVE"
      : "NOT_LIVE_PROBED",
    scheduledRead: readAccess.scheduledPosts
      ? "VERIFIED_LIVE"
      : "NOT_LIVE_PROBED",
    pagination: paginationObserved
      ? "VERIFIED_LIVE"
      : "VERIFIED_BY_CONTRACT_TEST",
    minimumLead20Minutes: "NOT_LIVE_PROBED",
    maximumAhead29Days: "NOT_LIVE_PROBED",
    explicitTimezoneOffsetToUtc: "VERIFIED_BY_CONTRACT_TEST",
    appOfflineNativePublish: "VERIFIED_BY_EXISTING_LIVE_EVIDENCE",
    businessSuiteMutationReadback: "VERIFIED_BY_EXISTING_LIVE_EVIDENCE",
  };

  if (execute) {
    const publishedId = await pageClient.publishText(
      pageId,
      `${marker} plain-text publish smoke`,
    );
    const publishedArtifact: SmokeArtifact = {
      kind: "plain_text_publish",
      remotePostId: publishedId,
      created: true,
      verified: false,
      cleanup: "pending",
    };
    artifacts.push(publishedArtifact);
    const publishedVerification = await waitForPostState({
      client: pageClient,
      pageId,
      kind: "published",
      remotePostId: publishedId,
      shouldExist: true,
    });
    paginationObserved ||= publishedVerification.paginationObserved;
    if (!publishedVerification.matched) {
      throw new Error("PUBLISHED_POST_READBACK_FAILED");
    }
    publishedArtifact.verified = true;
    checks.plainTextPublish = "VERIFIED_LIVE";

    const scheduledFor = new Date(
      Date.now() + (MIN_SCHEDULE_LEAD_MINUTES + 10) * 60_000,
    );
    const scheduledId = await pageClient.scheduleText(
      pageId,
      `${marker} native schedule smoke`,
      scheduledFor,
    );
    const scheduledArtifact: SmokeArtifact = {
      kind: "native_text_schedule",
      remotePostId: scheduledId,
      created: true,
      verified: false,
      rescheduled: false,
      cleanup: "pending",
    };
    artifacts.push(scheduledArtifact);
    const scheduledVerification = await waitForPostState({
      client: pageClient,
      pageId,
      kind: "scheduled",
      remotePostId: scheduledId,
      shouldExist: true,
      scheduledFor,
    });
    paginationObserved ||= scheduledVerification.paginationObserved;
    if (!scheduledVerification.matched) {
      throw new Error("SCHEDULED_POST_READBACK_FAILED");
    }
    scheduledArtifact.verified = true;
    checks.nativeTextSchedule = "VERIFIED_LIVE";

    const rescheduledFor = new Date(scheduledFor.getTime() + 10 * 60_000);
    await pageClient.reschedulePost(scheduledId, rescheduledFor);
    const rescheduleVerification = await waitForPostState({
      client: pageClient,
      pageId,
      kind: "scheduled",
      remotePostId: scheduledId,
      shouldExist: true,
      scheduledFor: rescheduledFor,
    });
    paginationObserved ||= rescheduleVerification.paginationObserved;
    if (!rescheduleVerification.matched) {
      throw new Error("RESCHEDULE_READBACK_FAILED");
    }
    scheduledArtifact.rescheduled = true;
    checks.reschedule = "VERIFIED_LIVE";

    await pageClient.cancelScheduledPost(scheduledId);
    const cancelVerification = await waitForPostState({
      client: pageClient,
      pageId,
      kind: "scheduled",
      remotePostId: scheduledId,
      shouldExist: false,
    });
    paginationObserved ||= cancelVerification.paginationObserved;
    if (!cancelVerification.matched) throw new Error("CANCEL_READBACK_FAILED");
    scheduledArtifact.cleanup = "succeeded";
    checks.cancelScheduled = "VERIFIED_LIVE";

    await pageClient.deletePost(publishedId);
    const deleteVerification = await waitForPostState({
      client: pageClient,
      pageId,
      kind: "published",
      remotePostId: publishedId,
      shouldExist: false,
    });
    paginationObserved ||= deleteVerification.paginationObserved;
    if (!deleteVerification.matched) throw new Error("DELETE_READBACK_FAILED");
    publishedArtifact.cleanup = "succeeded";
    checks.deletePublished = "VERIFIED_LIVE";
  }

  checks.pagination = paginationObserved
    ? "VERIFIED_LIVE"
    : "VERIFIED_BY_CONTRACT_TEST";
  report = {
    event: "meta_capability_smoke_succeeded",
    mode: execute ? "execute" : "discovery_only",
    graphVersion,
    runAt: runAt.toISOString(),
    targetPage: {
      id: pageId,
      name: verifiedPage.name,
      category: verifiedPage.category ?? null,
      discoverableViaManagedPages: Boolean(discoveredPage),
      tasks: discoveredPage?.tasks ?? [],
    },
    tokenEvidence: {
      currentUserLookup: Boolean(user.id),
      userTokenType: userToken.type ?? null,
      userTokenScopes: [...userToken.scopes].sort(),
      pageTokenType: pageToken.type ?? null,
      pageTokenScopes: [...pageToken.scopes].sort(),
      accessTier: "NOT_EXPOSED_BY_META_DEBUG_TOKEN",
    },
    schedulingPolicy: {
      minimumLeadMinutes: MIN_SCHEDULE_LEAD_MINUTES,
      maximumAheadDays: MAX_SCHEDULE_AHEAD_DAYS,
      applicationTimezone: "Asia/Ho_Chi_Minh (UTC+07:00)",
      persistence: "UTC instant",
    },
    initialReads: {
      publishedCountFirstPage: publishedRead.posts.length,
      scheduledCountFirstPage: scheduledRead.posts.length,
    },
    checks,
    artifacts,
    cleanupSucceeded: artifacts.every(
      (artifact) => artifact.cleanup === "succeeded",
    ),
  };
  exitCode = 0;
} catch (error) {
  report = {
    event: "meta_capability_smoke_failed",
    mode: execute ? "execute" : "discovery_only",
    graphVersion,
    runAt: runAt.toISOString(),
    targetPage: { id: pageId, expectedName: expectedPageName },
    code: stableErrorCode(error),
    artifacts,
  };
} finally {
  if (pageClient) {
    for (const artifact of artifacts) {
      if (artifact.cleanup !== "pending") continue;
      try {
        await pageClient.deletePost(artifact.remotePostId);
        artifact.cleanup = "succeeded";
      } catch {
        artifact.cleanup = "failed";
        cleanupSucceeded = false;
      }
    }
  }
}

if (!cleanupSucceeded || artifacts.some((item) => item.cleanup === "failed")) {
  exitCode = 1;
  report = {
    ...report!,
    event: "meta_capability_smoke_cleanup_failed",
    cleanupSucceeded: false,
    artifacts,
  };
} else if (artifacts.length > 0) {
  report = { ...report!, cleanupSucceeded: true, artifacts };
}

console.log(JSON.stringify(report!, null, 2));
process.exitCode = exitCode;
