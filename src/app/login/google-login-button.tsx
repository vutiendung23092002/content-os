"use client";

import { useState } from "react";
import { useToast } from "@/app/ui/toast-provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function GoogleLoginButton({ next }: { next: string }) {
  const { showToast, updateToast } = useToast();
  const [loading, setLoading] = useState(false);

  async function login() {
    const toastId = showToast({
      tone: "loading",
      title: "Đang mở Google",
      description: "Bạn sẽ được chuyển tới màn hình chọn tài khoản.",
      duration: null,
    });
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
      updateToast(toastId, {
        tone: "error",
        title: "Không thể mở Google",
        description: "Hãy kiểm tra cấu hình Supabase Auth rồi thử lại.",
        duration: null,
      });
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
    </div>
  );
}
