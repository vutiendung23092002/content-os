"use client";

import { useCallback, useEffect, useState } from "react";
import type { Viewer } from "@/lib/auth/types";

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: Viewer["role"];
  approvalStatus: Viewer["approvalStatus"];
  isBootstrapSuperAdmin: boolean;
};

const statusLabels = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  suspended: "Tạm khóa",
};

async function apiRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error?.message ?? "Thao tác thất bại.");
  return payload;
}

export function UserPanel({ viewer }: { viewer: Viewer }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const payload = await apiRequest("/api/admin/users");
    setUsers(payload.users);
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest("/api/admin/users")
      .then((payload) => {
        if (active) setUsers(payload.users);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function addEmail(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      setMessage("Đã thêm email vào allowlist.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function update(
    userId: string,
    kind: "approval" | "role",
    body: object,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/users/${userId}/${kind}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adminUsersGrid">
      <section className="panel adminAllowlistCard">
        <div>
          <span className="sectionEyebrow">ALLOWLIST</span>
          <h2>Cho phép email mới</h2>
          <p>Email có thể được thêm trước khi nhân sự đăng nhập lần đầu.</p>
        </div>
        <form className="allowlistForm" onSubmit={addEmail}>
          <input
            aria-label="Email Google"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nhansu@congty.com"
            required
            type="email"
            value={email}
          />
          <select
            aria-label="Vai trò"
            onChange={(event) =>
              setRole(event.target.value as "admin" | "member")
            }
            value={role}
          >
            <option value="member">Nhân viên</option>
            {viewer.role === "super_admin" ? (
              <option value="admin">Admin</option>
            ) : null}
          </select>
          <button className="button" disabled={busy} type="submit">
            Thêm email
          </button>
        </form>
        {message ? <p className="adminMessage">{message}</p> : null}
      </section>

      <section className="panel userListCard">
        <div className="userListHeader">
          <div>
            <span className="sectionEyebrow">THÀNH VIÊN</span>
            <h2>Tài khoản truy cập</h2>
          </div>
          <span>{users.length} tài khoản</span>
        </div>
        <div className="userRows">
          {users.map((user) => {
            const protectedUser =
              user.isBootstrapSuperAdmin || user.role === "super_admin";
            const canManage =
              !protectedUser &&
              (viewer.role === "super_admin" || user.role === "member");
            return (
              <article className="userRow" key={user.id}>
                <div className="userIdentity">
                  {user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={user.avatarUrl} />
                  ) : (
                    <span>{user.name.slice(0, 1).toUpperCase()}</span>
                  )}
                  <div>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </div>
                </div>
                <span className={`statusBadge is-${user.approvalStatus}`}>
                  {statusLabels[user.approvalStatus]}
                </span>
                <select
                  aria-label={`Vai trò của ${user.email}`}
                  disabled={
                    busy || viewer.role !== "super_admin" || protectedUser
                  }
                  onChange={(event) =>
                    void update(user.id, "role", { role: event.target.value })
                  }
                  value={user.role === "super_admin" ? "admin" : user.role}
                >
                  <option value="member">Nhân viên</option>
                  <option value="admin">Admin</option>
                </select>
                <div className="userActions">
                  {canManage && user.approvalStatus !== "approved" ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void update(user.id, "approval", { status: "approved" })
                      }
                      type="button"
                    >
                      Duyệt
                    </button>
                  ) : null}
                  {canManage && user.approvalStatus === "approved" ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void update(user.id, "approval", {
                          status: "suspended",
                        })
                      }
                      type="button"
                    >
                      Tạm khóa
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
