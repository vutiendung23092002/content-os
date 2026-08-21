import type { AppUserRecord } from "@/db/repositories/app-user-repository";
import type { Viewer } from "@/lib/auth/types";
import { AppError } from "@/lib/errors/app-error";

export function isAdmin(viewer: Viewer): boolean {
  return viewer.role === "admin" || viewer.role === "super_admin";
}

export function assertCanChangeApproval(
  actor: Viewer,
  target: AppUserRecord,
): void {
  if (actor.approvalStatus !== "approved" || !isAdmin(actor)) {
    throw new AppError({
      code: "ADMIN_REQUIRED",
      message: "Thao tác này chỉ dành cho Admin.",
      status: 403,
    });
  }
  if (target.isBootstrapSuperAdmin || target.role === "super_admin") {
    throw new AppError({
      code: "SUPER_ADMIN_PROTECTED",
      message: "Không thể thay đổi trạng thái Super Admin.",
      status: 409,
    });
  }
  if (target.role === "admin" && actor.role !== "super_admin") {
    throw new AppError({
      code: "SUPER_ADMIN_REQUIRED",
      message: "Chỉ Super Admin được thay đổi trạng thái của Admin.",
      status: 403,
    });
  }
}

export function assertCanAssignRole(
  actor: Viewer,
  role: "admin" | "member",
): void {
  if (actor.approvalStatus !== "approved" || !isAdmin(actor)) {
    throw new AppError({
      code: "ADMIN_REQUIRED",
      message: "Thao tác này chỉ dành cho Admin.",
      status: 403,
    });
  }
  if (role === "admin" && actor.role !== "super_admin") {
    throw new AppError({
      code: "SUPER_ADMIN_REQUIRED",
      message: "Chỉ Super Admin được bổ nhiệm Admin.",
      status: 403,
    });
  }
}

export function assertCanChangeRole(
  actor: Viewer,
  target: AppUserRecord,
): void {
  assertCanAssignRole(actor, "admin");
  if (target.isBootstrapSuperAdmin || target.role === "super_admin") {
    throw new AppError({
      code: "SUPER_ADMIN_PROTECTED",
      message: "Không thể thay đổi vai trò Super Admin.",
      status: 409,
    });
  }
}
