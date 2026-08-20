import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptToken } from "@/lib/crypto/token-crypto";
import {
  syncManagedPages,
  type ManagedPagesClient,
  type PersistManagedPages,
} from "./sync-managed-pages";

describe("syncManagedPages", () => {
  it("paginates, encrypts Page tokens and returns only safe data", async () => {
    const key = randomBytes(32).toString("base64");
    const getManagedPages = vi
      .fn<ManagedPagesClient["getManagedPages"]>()
      .mockResolvedValueOnce({
        pages: [
          {
            externalPageId: "external-1",
            name: "Page One",
            accessToken: "page-token-1",
            tasks: ["CREATE_CONTENT"],
          },
        ],
        after: "cursor-2",
      })
      .mockResolvedValueOnce({
        pages: [
          {
            externalPageId: "external-2",
            name: "Page Two",
            accessToken: "page-token-2",
            category: "Community",
            tasks: [],
          },
        ],
      });
    const persist = vi
      .fn<PersistManagedPages>()
      .mockImplementation(async (pages) => {
        expect(decryptToken(pages[0]!.encryptedAccessToken, key)).toBe(
          "page-token-1",
        );
        expect(decryptToken(pages[1]!.encryptedAccessToken, key)).toBe(
          "page-token-2",
        );
        expect(JSON.stringify(pages)).not.toContain("page-token-1");

        return pages.map((page, index) => ({
          id: `local-${index + 1}`,
          externalPageId: page.externalPageId,
          name: page.name,
          category: page.category,
          tasks: page.tasks,
        }));
      });

    const result = await syncManagedPages({
      client: { getManagedPages },
      encryptionKey: key,
      persist,
    });

    expect(getManagedPages).toHaveBeenNthCalledWith(1, undefined);
    expect(getManagedPages).toHaveBeenNthCalledWith(2, "cursor-2");
    expect(result).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("page-token");
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const key = randomBytes(32).toString("base64");
    const client: ManagedPagesClient = {
      getManagedPages: vi
        .fn()
        .mockResolvedValue({ pages: [], after: "same-cursor" }),
    };

    await expect(
      syncManagedPages({ client, encryptionKey: key }),
    ).rejects.toThrow("repeated Page cursor");
  });
});
