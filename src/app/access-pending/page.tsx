import { requireViewer } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const messages = {
  pending: "Tài khoản đang chờ Admin duyệt.",
  rejected: "Yêu cầu truy cập đã bị từ chối.",
  suspended: "Quyền truy cập của tài khoản đang bị tạm khóa.",
  approved: "Tài khoản đã được duyệt.",
} as const;

export default async function AccessPendingPage() {
  const viewer = await requireViewer();
  return (
    <main className="loginPage">
      <section className="loginCard" aria-labelledby="pending-title">
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
          <span>QUYỀN TRUY CẬP</span>
          <h1 id="pending-title">Chưa thể vào công cụ</h1>
          <p>{messages[viewer.approvalStatus]}</p>
        </div>
        <div className="pendingAccount">
          <strong>{viewer.name}</strong>
          <span>{viewer.email}</span>
        </div>
        <p className="loginNote">
          Hãy gửi email này cho Admin để được thêm vào allowlist.
        </p>
        <form action="/api/auth/logout" method="post">
          <button className="button secondaryButton" type="submit">
            Đăng xuất
          </button>
        </form>
      </section>
    </main>
  );
}
