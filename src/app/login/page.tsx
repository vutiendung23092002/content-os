import type { Metadata } from "next";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { GoogleLoginButton } from "./google-login-button";

export const metadata: Metadata = { title: "Đăng nhập | HanContent" };

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

function safeNextPath(value?: string): string {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const configured = hasSupabasePublicConfig();
  const message =
    params.error === "oauth"
      ? "Đăng nhập Google chưa hoàn tất. Vui lòng thử lại."
      : params.error === "not_configured" || !configured
        ? "Supabase Auth chưa được cấu hình trên máy chủ."
        : null;

  return (
    <main className="loginPage">
      <section className="loginCard" aria-labelledby="login-title">
        <div className="loginBrand">
          <span className="wordmarkMark" aria-hidden="true">
            H
          </span>
          <span>
            <strong>HanContent</strong>
            <small>Content OS</small>
          </span>
        </div>
        <div className="loginIntro">
          <span>TRUY CẬP NỘI BỘ</span>
          <h1 id="login-title">Mở không gian làm việc</h1>
          <p>
            Đăng nhập bằng Google. Chỉ email được Admin cho phép mới sử dụng
            được công cụ.
          </p>
        </div>
        {message ? <p className="loginError">{message}</p> : null}
        {configured ? (
          <GoogleLoginButton next={safeNextPath(params.next)} />
        ) : null}
        <p className="loginNote">
          Nhân sự không cần biết token Facebook hoặc mật khẩu hệ thống.
        </p>
      </section>
    </main>
  );
}
