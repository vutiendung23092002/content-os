import { randomUUID } from "node:crypto";
import { MetaGraphClient } from "../src/modules/facebook/meta-client";
import {
  MAX_SCHEDULE_AHEAD_DAYS,
  MIN_SCHEDULE_LEAD_MINUTES,
} from "../src/modules/posts/schedule-window";
import {
  assertDesignatedTestPage,
  cleanupPendingArtifacts,
  createSmokeArtifactWithRecovery,
  findRemotePostById,
  resolveSmokeExitCode,
  type CapabilityRemotePostKind,
  type SmokeArtifact,
} from "./meta-capability-smoke-core";

type VerificationLevel =
  | "VERIFIED_LIVE"
  | "VERIFIED_BY_EXISTING_LIVE_EVIDENCE"
  | "VERIFIED_BY_CONTRACT_TEST"
  | "NOT_LIVE_PROBED";

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

async function waitForPostState(input: {
  client: MetaGraphClient;
  pageId: string;
  kind: CapabilityRemotePostKind;
  remotePostId: string;
  shouldExist: boolean;
  scheduledFor?: Date;
}): Promise<{ matched: boolean; paginationObserved: boolean }> {
  let paginationObserved = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await findRemotePostById({
      client: input.client,
      pageId: input.pageId,
      kind: input.kind,
      remotePostId: input.remotePostId,
    });
    paginationObserved ||= result.paginationObserved;
    const exists = Boolean(result.post);
    const scheduledTime = result.post?.scheduled_publish_time;
    const scheduleMatches = input.scheduledFor
      ? scheduledTime !== undefined &&
        Math.abs(Number(scheduledTime) * 1000 - input.scheduledFor.getTime()) <=
          1_000
      : true;
    if (exists === input.shouldExist && (!exists || scheduleMatches)) {
      return { matched: true, paginationObserved };
    }
    if (attempt < 5) await delay(2_000);
  }
  return { matched: false, paginationObserved };
}

const graphVersion = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ?? "";
const pageId = argument("page-id");
const expectedPageName = argument("expected-page-name");
const confirmedGraphVersion = argument("confirm-graph-version");
const execute = hasFlag("execute");
const discoveryOnly = hasFlag("discovery-only");

if (!pageId || !expectedPageName || execute === discoveryOnly) {
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

try {
  assertDesignatedTestPage({
    pageId,
    expectedPageName,
    graphVersion,
    confirmedGraphVersion: confirmedGraphVersion ?? "",
    designatedPageId: process.env.FACEBOOK_CAPABILITY_TEST_PAGE_ID,
    designatedPageName: process.env.FACEBOOK_CAPABILITY_TEST_PAGE_NAME,
    pinnedGraphVersion: "v26.0",
    forceRequested: hasFlag("force"),
  });
} catch (error) {
  console.error(
    JSON.stringify({
      event: "meta_capability_smoke_rejected",
      code: stableErrorCode(error),
    }),
  );
  process.exit(1);
}

const userAccessToken = requiredEnvironment("FACEBOOK_USER_ACCESS_TOKEN");
const appId = requiredEnvironment("FACEBOOK_APP_ID");
const appSecret = requiredEnvironment("FACEBOOK_APP_SECRET");

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
    const publishedMessage = `${marker} plain-text publish smoke`;
    const publishedArtifact = await createSmokeArtifactWithRecovery({
      client: pageClient,
      pageId,
      remoteKind: "published",
      artifactKind: "plain_text_publish",
      exactMessage: publishedMessage,
      create: () => pageClient!.publishText(pageId, publishedMessage),
      artifacts,
      recoveryWait: () => delay(2_000),
    });
    const publishedId = publishedArtifact.remotePostId;
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
    const scheduledMessage = `${marker} native schedule smoke`;
    const scheduledArtifact = await createSmokeArtifactWithRecovery({
      client: pageClient,
      pageId,
      remoteKind: "scheduled",
      artifactKind: "native_text_schedule",
      exactMessage: scheduledMessage,
      create: () =>
        pageClient!.scheduleText(pageId, scheduledMessage, scheduledFor),
      artifacts,
      recoveryWait: () => delay(2_000),
    });
    scheduledArtifact.rescheduled = false;
    const scheduledId = scheduledArtifact.remotePostId;
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
    cleanupSucceeded = await cleanupPendingArtifacts(pageClient, artifacts);
  }
}

if (!cleanupSucceeded || artifacts.some((item) => item.cleanup === "failed")) {
  exitCode = resolveSmokeExitCode({
    requestedExitCode: exitCode,
    cleanupSucceeded: false,
  });
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
