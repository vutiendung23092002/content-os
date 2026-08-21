import { describe, expect, it } from "vitest";
import type { AppUserRecord } from "@/db/repositories/app-user-repository";
import type { Viewer } from "@/lib/auth/types";
import {
  assertCanAssignRole,
  assertCanChangeApproval,
  assertCanChangeRole,
} from "./admin-policy";

const member = {
  id: "member-id",
  email: "member@example.com",
  externalUserId: null,
  name: "Member",
  avatarUrl: null,
  role: "member",
  approvalStatus: "pending",
  approvedByUserId: null,
  approvedAt: null,
  lastLoginAt: null,
  isBootstrapSuperAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies AppUserRecord;

function viewer(role: Viewer["role"]): Viewer {
  return {
    id: `${role}-id`,
    externalUserId: `${role}-external-id`,
    email: `${role}@example.com`,
    name: role,
    role,
    approvalStatus: "approved",
    isBootstrapSuperAdmin: role === "super_admin",
  };
}

describe("admin allowlist policy", () => {
  it("allows an Admin to approve a member but not appoint another Admin", () => {
    expect(() =>
      assertCanChangeApproval(viewer("admin"), member),
    ).not.toThrow();
    expect(() => assertCanAssignRole(viewer("admin"), "admin")).toThrow(
      "Chỉ Super Admin",
    );
  });

  it("allows the Super Admin to assign roles", () => {
    expect(() =>
      assertCanAssignRole(viewer("super_admin"), "admin"),
    ).not.toThrow();
    expect(() =>
      assertCanChangeRole(viewer("super_admin"), member),
    ).not.toThrow();
  });

  it("protects the bootstrap Super Admin", () => {
    const owner = {
      ...member,
      role: "super_admin",
      isBootstrapSuperAdmin: true,
    } satisfies AppUserRecord;
    expect(() => assertCanChangeApproval(viewer("super_admin"), owner)).toThrow(
      "Không thể thay đổi trạng thái Super Admin",
    );
  });
});
