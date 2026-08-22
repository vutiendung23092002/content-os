import { describe, expect, it, vi } from "vitest";
import type { AppUserRecord } from "@/db/repositories/app-user-repository";
import type { PageRecord } from "@/db/repositories/page-repository";
import type { Viewer } from "@/lib/auth/types";
import { PageAccessService } from "./page-access-service";

const pageId = "018f0d44-35f0-7b63-99d2-c1b9222cd05c";
const userId = "118f0d44-35f0-7b63-99d2-c1b9222cd05c";

const page = {
  id: pageId,
  externalPageId: "123456789",
  name: "Page A",
  username: null,
  avatarUrl: null,
  category: null,
  timezone: null,
  isActive: true,
  connectionStatus: "active",
  lastSyncedAt: null,
  remoteMetadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies PageRecord;

function viewer(role: Viewer["role"]): Viewer {
  return {
    id: userId,
    externalUserId: "google-user",
    email: "user@example.com",
    name: "User",
    role,
    approvalStatus: "approved",
    isBootstrapSuperAdmin: role === "super_admin",
  };
}

function service(assigned: boolean, pageRecord: PageRecord | undefined = page) {
  return new PageAccessService({
    pages: {
      findById: vi.fn().mockResolvedValue(pageRecord),
      listActive: vi.fn().mockResolvedValue(pageRecord ? [pageRecord] : []),
    },
    users: {
      findById: vi
        .fn()
        .mockResolvedValue(undefined as AppUserRecord | undefined),
    },
    assignments: {
      has: vi.fn().mockResolvedValue(assigned),
      listForUser: vi
        .fn()
        .mockResolvedValue(
          assigned ? [{ id: "assignment", userId, pageId }] : [],
        ),
    },
    persistAssignments: vi.fn().mockResolvedValue(undefined),
  });
}

describe("Page access service", () => {
  it("gives Super Admin implicit access to every active Page", async () => {
    await expect(
      service(false).assertAccess(viewer("super_admin"), pageId),
    ).resolves.toBeUndefined();
  });

  it("denies a member when the Page was not assigned", async () => {
    await expect(
      service(false).assertAccess(viewer("member"), pageId),
    ).rejects.toMatchObject({ code: "PAGE_ACCESS_DENIED", status: 403 });
  });

  it("denies even a Super Admin after the Page is removed", async () => {
    await expect(
      service(false, { ...page, isActive: false }).assertAccess(
        viewer("super_admin"),
        pageId,
      ),
    ).rejects.toMatchObject({ code: "PAGE_NOT_FOUND", status: 404 });
  });

  it("marks unassigned Pages as locked in the selector DTO", async () => {
    const [result] = await service(false).listForViewer(viewer("member"));
    expect(result).toMatchObject({
      page: { id: pageId },
      canAccess: false,
      accessReason: expect.stringContaining("Admin"),
    });
  });
});
