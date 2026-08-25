import { requireAdmin } from "@/lib/auth/session";
import { AdminUserService } from "@/modules/auth/admin-user-service";
import { UserPanel } from "./user-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await requireAdmin();
  const users = await new AdminUserService().list();
  return (
    <main className="contentPage">
      <UserPanel initialUsers={users} viewer={viewer} />
    </main>
  );
}
