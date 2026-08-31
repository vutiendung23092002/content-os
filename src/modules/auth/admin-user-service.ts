import "server-only";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import {
  AppUserRepository,
  type ApprovalStatus,
  type AppRole,
  normalizeEmail,
  toAppUserDto,
} from "@/db/repositories/app-user-repository";
import type { Viewer } from "@/lib/auth/types";
import { AppError } from "@/lib/errors/app-error";
import {
  assertCanAssignRole,
  assertCanChangeApproval,
  assertCanChangeRole,
} from "./admin-policy";
import { PageRepository } from "@/db/repositories/page-repository";
import { UserPageAssignmentRepository } from "@/db/repositories/user-page-assignment-repository";

export const allowlistInputSchema = z
  .object({
    email: z.email().transform(normalizeEmail),
    role: z.enum(["admin", "member"]).default("member"),
  })
  .strict();

export const approvalInputSchema = z
  .object({
    status: z.enum(["approved", "rejected", "suspended"]),
  })
  .strict();

export const roleInputSchema = z
  .object({
    role: z.enum(["admin", "member"]),
  })
  .strict();

export class AdminUserService {
  private readonly users = new AppUserRepository(getDatabase());

  async list() {
    const [users, assignments, activePages] = await Promise.all([
      this.users.list(),
      new UserPageAssignmentRepository(getDatabase()).listAll(),
      new PageRepository(getDatabase()).listActive(),
    ]);
    const counts = new Map<string, number>();
    for (const assignment of assignments) {
      counts.set(assignment.userId, (counts.get(assignment.userId) ?? 0) + 1);
    }
    return users.map((user) => ({
      ...toAppUserDto(user),
      pageAccessCount:
        user.role === "super_admin"
          ? activePages.length
          : (counts.get(user.id) ?? 0),
    }));
  }

  async allowEmail(input: {
    actor: Viewer;
    email: string;
    role: Exclude<AppRole, "super_admin">;
  }) {
    assertCanAssignRole(input.actor, input.role);
    if (normalizeEmail(input.email) === input.actor.email) {
      throw new AppError({
        code: "USER_ALREADY_ALLOWED",
        message: "Email này đã có quyền truy cập.",
        status: 409,
      });
    }
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      assertCanChangeApproval(input.actor, existing);
      if (existing.role !== input.role) {
        assertCanChangeRole(input.actor, existing);
      }
    }
    return toAppUserDto(
      await this.users.allowEmail({
        email: input.email,
        role: input.role,
        approvedByUserId: input.actor.id,
      }),
    );
  }

  async setApproval(input: {
    actor: Viewer;
    userId: string;
    status: ApprovalStatus;
  }) {
    const target = await this.requireUser(input.userId);
    assertCanChangeApproval(input.actor, target);
    const updated = await this.users.setApproval({
      userId: target.id,
      approvalStatus: input.status,
      approvedByUserId: input.actor.id,
    });
    if (!updated) throw new Error("Failed to update approval status");
    return toAppUserDto(updated);
  }

  async setRole(input: {
    actor: Viewer;
    userId: string;
    role: Exclude<AppRole, "super_admin">;
  }) {
    const target = await this.requireUser(input.userId);
    assertCanChangeRole(input.actor, target);
    if (input.role === "admin" && target.approvalStatus !== "approved") {
      throw new AppError({
        code: "ADMIN_MUST_BE_APPROVED",
        message: "Tài khoản phải được duyệt trước khi bổ nhiệm Admin.",
        status: 409,
      });
    }
    const updated = await this.users.setRole(target.id, input.role);
    if (!updated) throw new Error("Failed to update role");
    return toAppUserDto(updated);
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
