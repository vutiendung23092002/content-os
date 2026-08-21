import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";
import { AppUserRepository } from "@/db/repositories/app-user-repository";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

function redirectWithCookies(url: URL, source: NextResponse) {
  const response = NextResponse.redirect(url);
  for (const cookie of source.cookies.getAll()) response.cookies.set(cookie);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";
  const isCallback = path === "/auth/callback";
  const isPending = path === "/access-pending";

  if (!hasSupabasePublicConfig()) {
    if (isLogin || isCallback) return NextResponse.next();
    return NextResponse.redirect(
      new URL("/login?error=not_configured", request.url),
    );
  }

  const { response, user } = await updateSupabaseSession(request);
  if (isCallback) return response;
  if (!user) {
    if (isLogin) return response;
    const loginUrl = new URL("/login", request.url);
    const next = `${path}${request.nextUrl.search}`;
    if (next !== "/" && !isPending) loginUrl.searchParams.set("next", next);
    return redirectWithCookies(loginUrl, response);
  }

  const users = new AppUserRepository(getDatabase());
  const appUser =
    (await users.findByExternalId(user.id)) ??
    (user.email ? await users.findByEmail(user.email) : undefined);
  const approved = appUser?.approvalStatus === "approved";

  if (!approved) {
    return isPending
      ? response
      : redirectWithCookies(new URL("/access-pending", request.url), response);
  }
  if (path.startsWith("/admin") && appUser.role === "member") {
    return redirectWithCookies(new URL("/", request.url), response);
  }
  if (isLogin || isPending) {
    return redirectWithCookies(new URL("/", request.url), response);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
