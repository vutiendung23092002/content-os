import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@/db/client", () => ({
  getDatabase: () => ({ execute }),
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("reports ready when the database is reachable", async () => {
    execute.mockResolvedValueOnce([]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "han-content-os",
      dependencies: { database: "ok" },
    });
  });

  it("returns 503 without leaking dependency errors", async () => {
    const secret = `postgresql:${"//"}operator:secret@staging.example/database`;
    execute.mockRejectedValueOnce(new Error(secret));

    const response = await GET();
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(body).toContain('"database":"unavailable"');
    expect(body).not.toContain(secret);
  });
});
