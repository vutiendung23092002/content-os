import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/db/client";
import { cronJobs } from "@/db/schema";
import { CronJobRepository } from "./cron-job-repository";

const integrationEnabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!integrationEnabled)("CronJobRepository", () => {
  afterAll(async () => {
    await closeDatabase();
  });

  it("rejects contention and allows a new owner after a stale lease", async () => {
    const database = getDatabase();
    const repository = new CronJobRepository(database);
    const jobKey = `integration.${randomUUID()}`;
    const startedAt = new Date("2026-08-25T04:00:00.000Z");

    try {
      expect(
        await repository.claim({
          jobKey,
          owner: "owner-1",
          now: startedAt,
          leaseMs: 60_000,
        }),
      ).toMatchObject({ leaseOwner: "owner-1" });

      expect(
        await repository.claim({
          jobKey,
          owner: "owner-2",
          now: new Date(startedAt.getTime() + 30_000),
          leaseMs: 60_000,
        }),
      ).toBeUndefined();

      expect(
        await repository.claim({
          jobKey,
          owner: "owner-2",
          now: new Date(startedAt.getTime() + 60_001),
          leaseMs: 60_000,
        }),
      ).toMatchObject({ leaseOwner: "owner-2" });
    } finally {
      await database.delete(cronJobs).where(eq(cronJobs.jobKey, jobKey));
    }
  });
});
