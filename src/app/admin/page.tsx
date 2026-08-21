import { requireAdmin } from "@/lib/auth/session";
import { UserPanel } from "./user-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await requireAdmin();
  return (
    <main className="contentPage">
      <div className="pageIntro">
        <div>
          <span>QUẢN TRỊ HỆ THỐNG</span>
          <h1>Nhân sự & phân quyền</h1>
          <p>Duyệt email được phép đăng nhập và chỉ định thêm Admin.</p>
        </div>
      </div>
      <UserPanel viewer={viewer} />
    </main>
  );
}
