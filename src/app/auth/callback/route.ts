import { NextResponse } from "next/server";
import { recordGoogleLogin } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null): string {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/";
}

function publicOrigin(request: Request): string {
  const configured = getServerEnv().NEXT_PUBLIC_SITE_URL;
  if (configured) return new URL(configured).origin;
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  return forwardedHost
    ? `${forwardedProto === "http" ? "http" : "https"}://${forwardedHost}`
    : new URL(request.url).origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login?error=oauth`);

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) throw userError ?? new Error("Missing user");
    const viewer = await recordGoogleLogin(data.user);
    if (viewer.approvalStatus !== "approved") {
      return NextResponse.redirect(`${origin}/access-pending`);
    }
    return NextResponse.redirect(
      `${origin}${safeNextPath(url.searchParams.get("next"))}`,
    );
  } catch {
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }
}
