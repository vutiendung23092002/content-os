export type AppRole = "super_admin" | "admin" | "member";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "suspended";

export type Viewer = {
  id: string;
  externalUserId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: AppRole;
  approvalStatus: ApprovalStatus;
  isBootstrapSuperAdmin: boolean;
};
