import "server-only";
import { asc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { appUsers } from "@/db/schema";

export type AppUserRecord = typeof appUsers.$inferSelect;
export type AppRole = AppUserRecord["role"];
export type ApprovalStatus = AppUserRecord["approvalStatus"];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class AppUserRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async findById(id: string): Promise<AppUserRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, id))
      .limit(1);
    return record;
  }

  async findByExternalId(
    externalUserId: string,
  ): Promise<AppUserRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(appUsers)
      .where(eq(appUsers.externalUserId, externalUserId))
      .limit(1);
    return record;
  }

  async findByEmail(email: string): Promise<AppUserRecord | undefined> {
    const [record] = await this.database
      .select()
      .from(appUsers)
      .where(eq(appUsers.email, normalizeEmail(email)))
      .limit(1);
    return record;
  }

  async list(): Promise<AppUserRecord[]> {
    return this.database.select().from(appUsers).orderBy(asc(appUsers.email));
  }

  async upsertGoogleIdentity(input: {
    externalUserId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }): Promise<AppUserRecord> {
    const now = new Date();
    const email = normalizeEmail(input.email);
    const [record] = await this.database
      .insert(appUsers)
      .values({
        externalUserId: input.externalUserId,
        email,
        name: input.name,
        avatarUrl: input.avatarUrl,
        lastLoginAt: now,
      })
      .onConflictDoUpdate({
        target: appUsers.email,
        set: {
          externalUserId: input.externalUserId,
          name: input.name,
          avatarUrl: input.avatarUrl,
          lastLoginAt: now,
          updatedAt: now,
        },
      })
      .returning();

    if (!record) throw new Error("Failed to upsert Google identity");
    return record;
  }

  async makeBootstrapSuperAdmin(input: {
    externalUserId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }): Promise<AppUserRecord> {
    const now = new Date();
    const email = normalizeEmail(input.email);

    await this.database
      .update(appUsers)
      .set({
        role: "admin",
        isBootstrapSuperAdmin: false,
        updatedAt: now,
      })
      .where(eq(appUsers.isBootstrapSuperAdmin, true));

    const [record] = await this.database
      .insert(appUsers)
      .values({
        externalUserId: input.externalUserId,
        email,
        name: input.name,
        avatarUrl: input.avatarUrl,
        role: "super_admin",
        approvalStatus: "approved",
        approvedAt: now,
        lastLoginAt: now,
        isBootstrapSuperAdmin: true,
      })
      .onConflictDoUpdate({
        target: appUsers.email,
        set: {
          externalUserId: input.externalUserId,
          name: input.name,
          avatarUrl: input.avatarUrl,
          role: "super_admin",
          approvalStatus: "approved",
          approvedByUserId: null,
          approvedAt: now,
          lastLoginAt: now,
          isBootstrapSuperAdmin: true,
          updatedAt: now,
        },
      })
      .returning();

    if (!record) throw new Error("Failed to bootstrap Super Admin");
    return record;
  }

  async allowEmail(input: {
    email: string;
    role: Exclude<AppRole, "super_admin">;
    approvedByUserId: string;
  }): Promise<AppUserRecord> {
    const now = new Date();
    const email = normalizeEmail(input.email);
    const [record] = await this.database
      .insert(appUsers)
      .values({
        email,
        name: email,
        role: input.role,
        approvalStatus: "approved",
        approvedByUserId: input.approvedByUserId,
        approvedAt: now,
      })
      .onConflictDoUpdate({
        target: appUsers.email,
        set: {
          role: input.role,
          approvalStatus: "approved",
          approvedByUserId: input.approvedByUserId,
          approvedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    if (!record) throw new Error("Failed to add email to allowlist");
    return record;
  }

  async setApproval(input: {
    userId: string;
    approvalStatus: ApprovalStatus;
    approvedByUserId: string;
  }): Promise<AppUserRecord | undefined> {
    const now = new Date();
    const approved = input.approvalStatus === "approved";
    const [record] = await this.database
      .update(appUsers)
      .set({
        approvalStatus: input.approvalStatus,
        approvedByUserId: input.approvedByUserId,
        approvedAt: approved ? now : null,
        updatedAt: now,
      })
      .where(eq(appUsers.id, input.userId))
      .returning();
    return record;
  }

  async setRole(
    userId: string,
    role: Exclude<AppRole, "super_admin">,
  ): Promise<AppUserRecord | undefined> {
    const [record] = await this.database
      .update(appUsers)
      .set({ role, updatedAt: new Date() })
      .where(eq(appUsers.id, userId))
      .returning();
    return record;
  }
}

export function toAppUserDto(user: AppUserRecord) {
  return {
    id: user.id,
    externalUserId: user.externalUserId,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    approvalStatus: user.approvalStatus,
    isBootstrapSuperAdmin: user.isBootstrapSuperAdmin,
    approvedAt: user.approvedAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
