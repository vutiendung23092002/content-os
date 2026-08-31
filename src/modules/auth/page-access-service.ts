import "server-only";
import { z } from "zod";
import { getDatabase, runInTransaction } from "@/db/client";
import { AppUserRepository } from "@/db/repositories/app-user-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import { UserPageAssignmentRepository } from "@/db/repositories/user-page-assignment-repository";
import type { Viewer } from "@/lib/auth/types";
import { AppError } from "@/lib/errors/app-error";
import { assertCanChangeApproval } from "./admin-policy";

export const pageAssignmentInputSchema = z
  .object({
    pageIds: z
      .array(z.uuid())
      .max(500)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

export class PageAccessService {
  private readonly pages: Pick<PageRepository, "findById" | "listActive">;
  private readonly users: Pick<AppUserRepository, "findById">;
  private readonly assignments: Pick<
    UserPageAssignmentRepository,
    "has" | "listForUser"
  >;
  private readonly persistAssignments: (input: {
    userId: string;
    pageIds: string[];
    assignedByUserId: string;
  }) => Promise<void>;

  constructor(dependencies?: {
    pages: Pick<PageRepository, "findById" | "listActive">;
    users: Pick<AppUserRepository, "findById">;
    assignments: Pick<UserPageAssignmentRepository, "has" | "listForUser">;
    persistAssignments: PageAccessService["persistAssignments"];
  }) {
    if (dependencies) {
      this.pages = dependencies.pages;
      this.users = dependencies.users;
      this.assignments = dependencies.assignments;
      this.persistAssignments = dependencies.persistAssignments;
      return;
    }
    const database = getDatabase();
    this.pages = new PageRepository(database);
    this.users = new AppUserRepository(database);
    this.assignments = new UserPageAssignmentRepository(database);
    this.persistAssignments = (input) =>
      runInTransaction(async (transaction) => {
        await new UserPageAssignmentRepository(transaction).replace(input);
      });
  }

  async listForViewer(viewer: Viewer) {
    const pages = await this.pages.listActive();
    const assignedIds =
      viewer.role === "super_admin"
        ? new Set(pages.map((page) => page.id))
        : new Set(
            (await this.assignments.listForUser(viewer.id)).map(
              (assignment) => assignment.pageId,
            ),
          );

    return pages.map((page) => ({
      page,
      canAccess: assignedIds.has(page.id),
      accessReason: assignedIds.has(page.id)
        ? null
        : "Admin chưa cấp Page này cho tài khoản của bạn.",
    }));
  }

  async assertAccess(viewer: Viewer, pageId: string): Promise<void> {
    const validPageId = z.uuid().parse(pageId);
    await this.assertPageActive(validPageId);
    if (viewer.role === "super_admin") return;
    if (await this.assignments.has(viewer.id, validPageId)) return;
    throw new AppError({
      code: "PAGE_ACCESS_DENIED",
      message: "Bạn chưa được Admin cấp quyền sử dụng Page này.",
      status: 403,
    });
  }

  async assertPageActive(pageId: string): Promise<void> {
    const validPageId = z.uuid().parse(pageId);
    const page = await this.pages.findById(validPageId);
    if (!page?.isActive) {
      throw new AppError({
        code: "PAGE_NOT_FOUND",
        message: "Page không tồn tại hoặc đã được gỡ khỏi hệ thống.",
        status: 404,
      });
    }
  }

  async accessiblePageIds(viewer: Viewer): Promise<Set<string> | null> {
    if (viewer.role === "super_admin") {
      return new Set((await this.pages.listActive()).map((page) => page.id));
    }
    const [assignments, activePages] = await Promise.all([
      this.assignments.listForUser(viewer.id),
      this.pages.listActive(),
    ]);
    const activeIds = new Set(activePages.map((page) => page.id));
    return new Set(
      assignments
        .map((assignment) => assignment.pageId)
        .filter((pageId) => activeIds.has(pageId)),
    );
  }

  async getAssignmentEditor(actor: Viewer, userId: string) {
    const target = await this.requireUser(userId);
    assertCanChangeApproval(actor, target);
    const pages = await this.pages.listActive();
    const targetIds =
      target.role === "super_admin"
        ? new Set(pages.map((page) => page.id))
        : new Set(
            (await this.assignments.listForUser(target.id)).map(
              (assignment) => assignment.pageId,
            ),
          );
    const actorIds =
      actor.role === "super_admin"
        ? new Set(pages.map((page) => page.id))
        : new Set(
            (await this.assignments.listForUser(actor.id)).map(
              (assignment) => assignment.pageId,
            ),
          );
    const targetProtected =
      target.role === "super_admin" || target.isBootstrapSuperAdmin;

    return {
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        avatarUrl: target.avatarUrl,
        role: target.role,
      },
      implicitAllPages: targetProtected,
      pages: pages.map((page) => ({
        id: page.id,
        externalPageId: page.externalPageId,
        name: page.name,
        avatarUrl: page.avatarUrl,
        category: page.category,
        assigned: targetIds.has(page.id),
        canAssign: !targetProtected && actorIds.has(page.id),
      })),
    };
  }

  async replaceAssignments(input: {
    actor: Viewer;
    userId: string;
    pageIds: string[];
  }) {
    const target = await this.requireUser(input.userId);
    assertCanChangeApproval(input.actor, target);

    const activePages = await this.pages.listActive();
    const activeIds = new Set(activePages.map((page) => page.id));
    if (input.pageIds.some((pageId) => !activeIds.has(pageId))) {
      throw new AppError({
        code: "PAGE_NOT_FOUND",
        message: "Có Page không tồn tại hoặc đã ngừng hoạt động.",
        status: 404,
      });
    }

    let nextIds = new Set(input.pageIds);
    if (input.actor.role !== "super_admin") {
      const existing = await this.assignments.listForUser(target.id);
      const existingIds = new Set(
        existing.map((assignment) => assignment.pageId),
      );
      const actorIds = new Set(
        (await this.assignments.listForUser(input.actor.id)).map(
          (assignment) => assignment.pageId,
        ),
      );
      if (
        input.pageIds.some(
          (pageId) => !actorIds.has(pageId) && !existingIds.has(pageId),
        )
      ) {
        throw new AppError({
          code: "PAGE_ASSIGNMENT_ESCALATION",
          message: "Admin chỉ được cấp những Page mình đang được quản lý.",
          status: 403,
        });
      }
      nextIds = new Set([
        ...existing
          .map((assignment) => assignment.pageId)
          .filter((pageId) => !actorIds.has(pageId)),
        ...input.pageIds,
      ]);
    }

    await this.persistAssignments({
      userId: target.id,
      pageIds: [...nextIds],
      assignedByUserId: input.actor.id,
    });
    return this.getAssignmentEditor(input.actor, target.id);
  }

  private async requireUser(userId: string) {
    const target = await this.users.findById(z.uuid().parse(userId));
    if (!target) {
      throw new AppError({
        code: "USER_NOT_FOUND",
        message: "Không tìm thấy tài khoản.",
        status: 404,
      });
    }
    return target;
  }
}
