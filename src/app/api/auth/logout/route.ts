import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const siteUrl = getServerEnv().NEXT_PUBLIC_SITE_URL;
  return NextResponse.redirect(new URL("/login", siteUrl ?? request.url), 303);
}
