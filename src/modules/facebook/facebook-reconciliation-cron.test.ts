import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import { FacebookReconciliationCronService } from "./facebook-reconciliation-cron";

const now = new Date("2026-08-25T04:00:00.000Z");

function claimed() {
  return {
    jobKey: "facebook.operation-reconciliation",
    cursor: null,
    leaseOwner: "owner",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    lastStartedAt: now,
    lastSuccessAt: null,
    lastError: null,
    updatedAt: now,
  };
}

function jobStore() {
  return {
    claim: vi.fn().mockResolvedValue(claimed()),
    checkpoint: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
  };
}

describe("FacebookReconciliationCronService", () => {
  it("does not overlap another reconciliation worker", async () => {
    const jobs = jobStore();
    jobs.claim.mockResolvedValue(undefined);
    const reconciliation = { list: vi.fn(), reconcile: vi.fn() };

    const result = await new FacebookReconciliationCronService(
      jobs,
      reconciliation,
      () => now,
    ).run();

    expect(result.status).toBe("locked");
    expect(reconciliation.list).not.toHaveBeenCalled();
  });

  it("processes only uncertain or stale pending operations", async () => {
    const jobs = jobStore();
    const reconciliation = {
      list: vi.fn().mockResolvedValue([
        { operationId: "uncertain-id", status: "uncertain" },
        { operationId: "pending-id", status: "pending" },
        { operationId: "attention-id", status: "needs_attention" },
      ]),
      reconcile: vi
        .fn()
        .mockResolvedValueOnce({ status: "succeeded" })
        .mockResolvedValueOnce({ status: "needs_attention" }),
    };

    const result = await new FacebookReconciliationCronService(
      jobs,
      reconciliation,
      () => now,
    ).run();

    expect(reconciliation.reconcile).toHaveBeenCalledTimes(2);
    expect(reconciliation.reconcile).not.toHaveBeenCalledWith("attention-id");
    expect(result).toEqual({
      status: "completed",
      scanned: 2,
      reconciled: 1,
      needsAttention: 1,
    });
  });

  it("retries a transient read only once, then preserves the cursor and releases the lease", async () => {
    const jobs = jobStore();
    const reconciliation = {
      list: vi
        .fn()
        .mockResolvedValue([
          { operationId: "operation-id", status: "uncertain" },
        ]),
      reconcile: vi.fn().mockRejectedValue(
        new AppError({
          code: "GRAPH_TEMPORARY",
          message: "temporary",
          retryable: true,
        }),
      ),
    };

    const service = new FacebookReconciliationCronService(
      jobs,
      reconciliation,
      () => now,
      async () => undefined,
    );

    await expect(service.run()).rejects.toMatchObject({
      code: "GRAPH_TEMPORARY",
    });
    expect(reconciliation.reconcile).toHaveBeenCalledTimes(2);
    expect(jobs.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: "GRAPH_TEMPORARY", retryable: true },
      }),
    );
  });
});
