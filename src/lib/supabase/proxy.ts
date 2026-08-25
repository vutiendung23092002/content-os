import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "./config";
import {
  type SupabaseIdentityClaims,
  toSupabaseIdentityClaims,
} from "./identity-claims";

export async function updateSupabaseSession(request: NextRequest): Promise<{
  response: NextResponse;
  identity: SupabaseIdentityClaims | null;
}> {
  const config = getSupabasePublicConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  return {
    response,
    identity: toSupabaseIdentityClaims(error ? null : data?.claims),
  };
}
