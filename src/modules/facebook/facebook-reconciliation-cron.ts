import "server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "@/db/client";
import {
  CronJobRepository,
  type CronJobRecord,
} from "@/db/repositories/cron-job-repository";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";
import {
  ReconcileFacebookOperationService,
  type ReconciliationResult,
} from "./reconcile-operations";

const JOB_KEY = "facebook.operation-reconciliation";
const LEASE_MS = 5 * 60 * 1000;
const DEFAULT_OPERATION_LIMIT = 25;
const MAX_RECONCILIATION_ATTEMPTS = 2;

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

type ReconciliationPort = {
  list(limit?: number): Promise<
    Array<{
      operationId: string;
      status: string;
    }>
  >;
  reconcile(operationId: unknown): Promise<ReconciliationResult>;
};

export type FacebookReconciliationCronResult = {
  status: "completed" | "locked";
  scanned: number;
  reconciled: number;
  needsAttention: number;
};

function safeError(error: unknown): Record<string, unknown> {
  return {
    code:
      error instanceof AppError
        ? error.code
        : "FACEBOOK_RECONCILIATION_CRON_FAILED",
    retryable: error instanceof AppError ? error.retryable : true,
  };
}

export class FacebookReconciliationCronService {
  constructor(
    private readonly jobs: JobStore = new CronJobRepository(getDatabase()),
    private readonly reconciliation: ReconciliationPort = new ReconcileFacebookOperationService(),
    private readonly now: () => Date = () => new Date(),
    private readonly delay: (milliseconds: number) => Promise<void> = (
      milliseconds,
    ) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async run(
    operationLimit = DEFAULT_OPERATION_LIMIT,
  ): Promise<FacebookReconciliationCronResult> {
    const owner = randomUUID();
    const claimed = await this.jobs.claim({
      jobKey: JOB_KEY,
      owner,
      now: this.now(),
      leaseMs: LEASE_MS,
    });
    if (!claimed) {
      logger.info({ event: "cron.skipped_locked", jobKey: JOB_KEY });
      return {
        status: "locked",
        scanned: 0,
        reconciled: 0,
        needsAttention: 0,
      };
    }

    let reconciled = 0;
    let needsAttention = 0;
    const limit = Math.min(Math.max(operationLimit, 1), 100);
    logger.info({ event: "cron.started", jobKey: JOB_KEY, owner });

    try {
      const operations = (await this.reconciliation.list(limit)).filter(
        (operation) =>
          operation.status === "uncertain" || operation.status === "pending",
      );
      for (const operation of operations) {
        const result = await this.reconcileWithRetry(operation.operationId);
        if (result.status === "succeeded") reconciled += 1;
        else needsAttention += 1;

        const checkpointed = await this.jobs.checkpoint({
          jobKey: JOB_KEY,
          owner,
          cursor: operation.operationId,
          now: this.now(),
          leaseMs: LEASE_MS,
        });
        if (!checkpointed) {
          throw new AppError({
            code: "FACEBOOK_CRON_LEASE_LOST",
            message: "Facebook reconciliation cron đã mất lease.",
            status: 409,
            retryable: true,
          });
        }
      }

      const completed = await this.jobs.complete({
        jobKey: JOB_KEY,
        owner,
        cursor: null,
        now: this.now(),
      });
      if (!completed) {
        throw new AppError({
          code: "FACEBOOK_CRON_LEASE_LOST",
          message: "Facebook reconciliation cron đã mất lease.",
          status: 409,
          retryable: true,
        });
      }
      logger.info({
        event: "cron.completed",
        jobKey: JOB_KEY,
        scanned: operations.length,
        reconciled,
        needsAttention,
      });
      return {
        status: "completed",
        scanned: operations.length,
        reconciled,
        needsAttention,
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

  private async reconcileWithRetry(
    operationId: string,
  ): Promise<ReconciliationResult> {
    for (
      let attempt = 1;
      attempt <= MAX_RECONCILIATION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.reconciliation.reconcile(operationId);
      } catch (error) {
        const retryable =
          !(error instanceof AppError) || error.retryable === true;
        if (attempt === MAX_RECONCILIATION_ATTEMPTS || !retryable) throw error;
        await this.delay(100 * attempt);
      }
    }
    throw new Error("unreachable");
  }
}
