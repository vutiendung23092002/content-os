import { requireAdmin } from "@/lib/auth/session";
import { UserPanel } from "./user-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await requireAdmin();
  return (
    <main className="contentPage">
      <UserPanel viewer={viewer} />
    </main>
  );
}
