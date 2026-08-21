"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function GoogleLoginButton({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login() {
    setError(null);
    setLoading(true);
    try {
      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("next", next);
      const supabase = createSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectTo.toString(),
          scopes: "openid email profile",
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) throw oauthError;
    } catch {
      setError("Không thể mở Google. Hãy kiểm tra cấu hình Supabase Auth.");
      setLoading(false);
    }
  }

  return (
    <div className="loginForm">
      <button
        className="button googleLoginButton"
        disabled={loading}
        onClick={login}
        type="button"
      >
        <span aria-hidden="true">G</span>
        {loading ? "Đang chuyển hướng..." : "Tiếp tục với Google"}
      </button>
      {error ? <p className="loginError">{error}</p> : null}
    </div>
  );
}
