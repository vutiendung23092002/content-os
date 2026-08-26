import "server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "@/db/client";
import {
  CronJobRepository,
  type CronJobRecord,
} from "@/db/repositories/cron-job-repository";
import {
  PageRepository,
  type PageRecord,
} from "@/db/repositories/page-repository";

import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";
import {
  RemotePostReader,
  type RemoteFacebookPost,
  type RemotePostKind,
} from "./remote-post-reader";

import { RemotePostMirror } from "./remote-post-mirror";

const JOB_KEY = "facebook.remote-post-sync";
const LEASE_MS = 5 * 60 * 1000;
const DEFAULT_PAGE_LIMIT = 5;
const MAX_REMOTE_PAGES = 10;
const MAX_READ_ATTEMPTS = 2;
const PUBLISHED_LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000;
const SCHEDULED_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SCHEDULED_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

type JobStore = {
  claim(input: {
    jobKey: string;
    owner: string;
    now: Date;
    leaseMs: number;
  }): Promise<CronJobRecord | undefined>;
  checkpoint(input: {
    jobKey: string;
    owner: string;
    cursor: string | null;
    now: Date;
    leaseMs: number;
  }): Promise<boolean>;
  complete(input: {
    jobKey: string;
    owner: string;
    cursor: string | null;
    now: Date;
  }): Promise<boolean>;
  fail(input: {
    jobKey: string;
    owner: string;
    error: Record<string, unknown>;
    now: Date;
  }): Promise<boolean>;
};

type PageStore = {
  listActiveBatch(input: {
    afterId?: string;
    limit: number;
  }): Promise<PageRecord[]>;
};

// type PostStore = Pick<PostRepository, "upsertRemotePosts">;
type RemotePostMirrorPort = Pick<RemotePostMirror, "replaceWindow">;
type Reader = Pick<RemotePostReader, "list">;

export type FacebookSyncCronResult = {
  status: "completed" | "locked";
  pagesProcessed: number;
  postsMirrored: number;
  nextCursor: string | null;
};

function safeError(error: unknown): Record<string, unknown> {
  return {
    code: error instanceof AppError ? error.code : "FACEBOOK_SYNC_FAILED",
    retryable: error instanceof AppError ? error.retryable : true,
  };
}

function shouldRetry(error: unknown): boolean {
  return !(error instanceof AppError) || error.retryable;
}

export class FacebookSyncCronService {
  constructor(
    private readonly jobs: JobStore = new CronJobRepository(getDatabase()),
    private readonly pages: PageStore = new PageRepository(getDatabase()),
    private readonly mirror: RemotePostMirrorPort = new RemotePostMirror(),
    private readonly reader: Reader = new RemotePostReader(),
    private readonly now: () => Date = () => new Date(),
    private readonly delay: (milliseconds: number) => Promise<void> = (
      milliseconds,
    ) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async run(pageLimit = DEFAULT_PAGE_LIMIT): Promise<FacebookSyncCronResult> {
    const owner = randomUUID();
    const startedAt = this.now();
    const claimed = await this.jobs.claim({
      jobKey: JOB_KEY,
      owner,
      now: startedAt,
      leaseMs: LEASE_MS,
    });
    if (!claimed) {
      logger.info({ event: "cron.skipped_locked", jobKey: JOB_KEY });
      return {
        status: "locked",
        pagesProcessed: 0,
        postsMirrored: 0,
        nextCursor: null,
      };
    }

    const limit = Math.min(Math.max(pageLimit, 1), 25);
    let cursor = claimed.cursor;
    let processed = 0;
    let mirrored = 0;

    logger.info({ event: "cron.started", jobKey: JOB_KEY, owner });
    try {
      let batch = await this.pages.listActiveBatch({
        afterId: cursor ?? undefined,
        limit,
      });
      if (batch.length === 0 && cursor) {
        cursor = null;
        batch = await this.pages.listActiveBatch({ limit });
      }

      for (const page of batch) {
        mirrored += await this.syncPage(page.id, startedAt);
        processed += 1;
        cursor = page.id;
        const checkpointed = await this.jobs.checkpoint({
          jobKey: JOB_KEY,
          owner,
          cursor,
          now: this.now(),
          leaseMs: LEASE_MS,
        });
        if (!checkpointed) {
          throw new AppError({
            code: "FACEBOOK_CRON_LEASE_LOST",
            message: "Facebook sync cron đã mất lease.",
            status: 409,
            retryable: true,
          });
        }
      }

      const nextCursor = batch.length < limit ? null : cursor;
      const completed = await this.jobs.complete({
        jobKey: JOB_KEY,
        owner,
        cursor: nextCursor,
        now: this.now(),
      });
      if (!completed) {
        throw new AppError({
          code: "FACEBOOK_CRON_LEASE_LOST",
          message: "Facebook sync cron đã mất lease.",
          status: 409,
          retryable: true,
        });
      }
      logger.info({
        event: "cron.completed",
        jobKey: JOB_KEY,
        pagesProcessed: processed,
        postsMirrored: mirrored,
      });
      return {
        status: "completed",
        pagesProcessed: processed,
        postsMirrored: mirrored,
        nextCursor,
      };
    } catch (error) {
      await this.jobs.fail({
        jobKey: JOB_KEY,
        owner,
        error: safeError(error),
        now: this.now(),
      });
      logger.error({
        event: "cron.failed",
        jobKey: JOB_KEY,
        ...safeError(error),
      });
      throw error;
    }
  }

  private async syncPage(pageId: string, runAt: Date): Promise<number> {
    const publishedWindow = {
      since: new Date(runAt.getTime() - PUBLISHED_LOOKBACK_MS),
      until: new Date(runAt.getTime() + 60_000),
    };
    const scheduledWindow = {
      since: new Date(runAt.getTime() - SCHEDULED_LOOKBACK_MS),
      until: new Date(runAt.getTime() + SCHEDULED_HORIZON_MS),
    };
    const published = await this.readAll(pageId, "published", publishedWindow);
    const scheduled = await this.readAll(pageId, "scheduled", scheduledWindow);
    return published + scheduled;
  }

  private async readAll(
    pageId: string,
    kind: RemotePostKind,
    window: { since: Date; until: Date },
  ): Promise<number> {
    let after: string | undefined;

    const collected: RemoteFacebookPost[] = [];
    const seenCursors = new Set<string>();

    for (let remotePage = 0; remotePage < MAX_REMOTE_PAGES; remotePage += 1) {
      const result = await this.readWithRetry({
        localPageId: pageId,
        kind,
        after,
        limit: 100,

        // Published API hỗ trợ since/until trực tiếp.
        // Scheduled thì lấy danh sách rồi filter local bên dưới.
        window: kind === "published" ? window : undefined,
      });

      const inWindow = result.posts.filter((post) => {
        if (!post.effectiveAt) {
          return false;
        }

        const timestamp = new Date(post.effectiveAt).getTime();

        return (
          timestamp >= window.since.getTime() &&
          timestamp < window.until.getTime()
        );
      });

      collected.push(...inWindow);

      /*
       * Không còn cursor nghĩa là đã đọc hết snapshot.
       *
       * Chỉ lúc này mới được reconcile local DB,
       * vì giờ ta mới chắc collected[] là toàn bộ dữ liệu
       * Facebook trong window.
       */
      if (!result.after || result.posts.length === 0) {
        const mirrored = await this.mirror.replaceWindow({
          pageId,
          kind,
          windowStart: window.since,
          windowEnd: window.until,
          posts: collected,
        });

        return mirrored.mirrored;
      }

      /*
       * Facebook trả lại cursor đã gặp trước đó.
       * Không được dùng snapshot chưa hoàn chỉnh
       * để đánh dấu bài local là deleted_remote.
       */
      if (seenCursors.has(result.after)) {
        throw new AppError({
          code: "FACEBOOK_SYNC_CURSOR_LOOP",
          message: "Facebook trả về cursor lặp lại.",
          status: 502,
          retryable: true,
        });
      }

      seenCursors.add(result.after);
      after = result.after;
    }

    /*
     * Chạy hết MAX_REMOTE_PAGES mà vẫn còn cursor
     * nghĩa là snapshot chưa complete.
     *
     * Tuyệt đối không gọi replaceWindow().
     */
    throw new AppError({
      code: "FACEBOOK_SYNC_PAGE_LIMIT",
      message: "Facebook sync vượt giới hạn phân trang an toàn.",
      status: 503,
      retryable: true,
    });
  }

  private async readWithRetry(
    input: Parameters<Reader["list"]>[0],
  ): ReturnType<Reader["list"]> {
    for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
      try {
        return await this.reader.list(input);
      } catch (error) {
        if (attempt === MAX_READ_ATTEMPTS || !shouldRetry(error)) throw error;
        await this.delay(100 * attempt);
      }
    }
    throw new Error("unreachable");
  }
}
