import "server-only";
import type { User } from "@supabase/supabase-js";
import { getDatabase } from "@/db/client";
import {
  AppUserRepository,
  normalizeEmail,
} from "@/db/repositories/app-user-repository";
import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors/app-error";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { toSupabaseIdentityClaims } from "@/lib/supabase/identity-claims";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Viewer } from "./types";

function toViewer(
  user: Awaited<ReturnType<AppUserRepository["findById"]>>,
): Viewer | null {
  if (!user?.externalUserId) return null;
  return {
    id: user.id,
    externalUserId: user.externalUserId,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? undefined,
    role: user.role,
    approvalStatus: user.approvalStatus,
    isBootstrapSuperAdmin: user.isBootstrapSuperAdmin,
  };
}

function googleProfile(user: User) {
  const providers = Array.isArray(user.app_metadata.providers)
    ? user.app_metadata.providers
    : [];
  if (
    user.app_metadata.provider !== "google" &&
    !providers.includes("google")
  ) {
    throw new AppError({
      code: "GOOGLE_ACCOUNT_REQUIRED",
      message: "Ứng dụng chỉ chấp nhận tài khoản Google.",
      status: 403,
    });
  }
  if (!user.email) {
    throw new AppError({
      code: "EMAIL_REQUIRED",
      message: "Tài khoản Google không cung cấp địa chỉ email.",
      status: 403,
    });
  }
  const email = normalizeEmail(user.email);
  const metadata = user.user_metadata;
  const name =
    (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata.name === "string" && metadata.name.trim()) ||
    email;
  const avatarUrl =
    typeof metadata.avatar_url === "string" ? metadata.avatar_url : undefined;
  return { externalUserId: user.id, email, name, avatarUrl };
}

export async function recordGoogleLogin(user: User): Promise<Viewer> {
  const profile = googleProfile(user);
  const repository = new AppUserRepository(getDatabase());
  const initialAdminEmail = getServerEnv().INITIAL_ADMIN_EMAIL;
  const record =
    initialAdminEmail && normalizeEmail(initialAdminEmail) === profile.email
      ? await repository.makeBootstrapSuperAdmin(profile)
      : await repository.upsertGoogleIdentity(profile);
  const viewer = toViewer(record);
  if (!viewer) throw new Error("Google identity was not linked to the user");
  return viewer;
}

export async function getOptionalViewer(): Promise<Viewer | null> {
  if (!hasSupabasePublicConfig()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const identity = toSupabaseIdentityClaims(error ? null : data?.claims);
  if (!identity) return null;
  const repository = new AppUserRepository(getDatabase());
  const record =
    (await repository.findByExternalId(identity.sub)) ??
    (identity.email ? await repository.findByEmail(identity.email) : undefined);
  return toViewer(record);
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getOptionalViewer();
  if (!viewer) {
    throw new AppError({
      code: "AUTHENTICATION_REQUIRED",
      message: "Vui lòng đăng nhập bằng Google.",
      status: 401,
    });
  }
  return viewer;
}

export async function requireApprovedViewer(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.approvalStatus !== "approved") {
    throw new AppError({
      code: "ACCOUNT_NOT_APPROVED",
      message: "Tài khoản chưa được Admin cho phép sử dụng.",
      status: 403,
    });
  }
  return viewer;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireApprovedViewer();
  if (viewer.role !== "admin" && viewer.role !== "super_admin") {
    throw new AppError({
      code: "ADMIN_REQUIRED",
      message: "Thao tác này chỉ dành cho Admin.",
      status: 403,
    });
  }
  return viewer;
}
