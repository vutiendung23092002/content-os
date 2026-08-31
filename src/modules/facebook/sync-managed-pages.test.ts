import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptToken } from "@/lib/crypto/token-crypto";
import { TokenKeyring } from "@/lib/crypto/token-keyring";
import {
  syncManagedPages,
  type ManagedPagesClient,
  type PersistManagedPages,
} from "./sync-managed-pages";

describe("syncManagedPages", () => {
  it("paginates, encrypts Page tokens and returns only safe data", async () => {
    const key = randomBytes(32).toString("base64");
    const tokenEncryption = new TokenKeyring({
      currentVersion: 1,
      currentKey: key,
    });
    const getManagedPages = vi
      .fn<ManagedPagesClient["getManagedPages"]>()
      .mockResolvedValueOnce({
        pages: [
          {
            externalPageId: "external-1",
            name: "Page One",
            accessToken: "page-token-1",
            avatarUrl: "https://images.test/page-one.jpg",
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
          avatarUrl: page.avatarUrl,
          category: page.category,
          tasks: page.tasks,
        }));
      });

    const result = await syncManagedPages({
      client: { getManagedPages },
      tokenEncryption,
      persist,
    });

    expect(getManagedPages).toHaveBeenNthCalledWith(1, undefined);
    expect(getManagedPages).toHaveBeenNthCalledWith(2, "cursor-2");
    expect(result).toHaveLength(2);
    expect(result[0]?.avatarUrl).toBe("https://images.test/page-one.jpg");
    expect(JSON.stringify(result)).not.toContain("page-token");
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const key = randomBytes(32).toString("base64");
    const tokenEncryption = new TokenKeyring({
      currentVersion: 1,
      currentKey: key,
    });
    const client: ManagedPagesClient = {
      getManagedPages: vi
        .fn()
        .mockResolvedValue({ pages: [], after: "same-cursor" }),
    };

    await expect(syncManagedPages({ client, tokenEncryption })).rejects.toThrow(
      "repeated Page cursor",
    );
  });

  it("does not persist a partial managed-Page snapshot", async () => {
    const tokenEncryption = new TokenKeyring({
      currentVersion: 1,
      currentKey: randomBytes(32).toString("base64"),
    });
    const client: ManagedPagesClient = {
      getManagedPages: vi
        .fn()
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
        .mockRejectedValueOnce(new Error("second page failed")),
    };
    const persist = vi.fn<PersistManagedPages>();

    await expect(
      syncManagedPages({ client, tokenEncryption, persist }),
    ).rejects.toThrow("second page failed");
    expect(persist).not.toHaveBeenCalled();
  });
});
