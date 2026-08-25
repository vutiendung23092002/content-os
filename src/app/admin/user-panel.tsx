"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/app/ui/toast-provider";
import type { Viewer } from "@/lib/auth/types";

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: Viewer["role"];
  approvalStatus: Viewer["approvalStatus"];
  isBootstrapSuperAdmin: boolean;
  pageAccessCount: number;
};
type AssignmentPage = {
  id: string;
  externalPageId: string;
  name: string;
  avatarUrl: string | null;
  category: string | null;
  assigned: boolean;
  canAssign: boolean;
};
type AssignmentEditor = {
  user: Pick<ManagedUser, "id" | "name" | "email" | "avatarUrl" | "role">;
  implicitAllPages: boolean;
  pages: AssignmentPage[];
};
type EditableRole = "admin" | "member";
type RoleOption = { value: EditableRole; label: string };

const statusLabels = {
  pending: "Chờ duyệt",
  approved: "Đang hoạt động",
  rejected: "Đã từ chối",
  suspended: "Tạm khóa",
};

async function apiRequest<ResponseBody>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as ResponseBody & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(payload.error?.message ?? "Thao tác thất bại.");
  return payload;
}

function UserAvatar({
  user,
}: {
  user: Pick<ManagedUser, "name" | "avatarUrl">;
}) {
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" src={user.avatarUrl} />
  ) : (
    <span aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
  );
}

function PageAvatar({
  page,
}: {
  page: Pick<AssignmentPage, "name" | "avatarUrl">;
}) {
  return page.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" src={page.avatarUrl} />
  ) : (
    <span className="pageAvatarFallback">{page.name.slice(0, 1)}</span>
  );
}

function SelectChevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m6.5 8 3.5 3.5L13.5 8" />
    </svg>
  );
}

function RoleSelect({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: EditableRole) => void;
  options: RoleOption[];
  value: EditableRole;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel =
    options.find((option) => option.value === value)?.label ??
    (value === "admin" ? "Admin" : "Nhân viên");

  useEffect(() => {
    if (!open) return;

    function closeFromOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [open]);

  return (
    <div className={`roleSelect ${open ? "isOpen" : ""}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="roleSelectTrigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === "Escape") setOpen(false);
        }}
        type="button"
      >
        <span>{selectedLabel}</span>
        <SelectChevron />
      </button>
      {open ? (
        <div aria-label={ariaLabel} className="roleSelectMenu" role="listbox">
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? "isSelected" : undefined}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? <b aria-hidden="true">✓</b> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function UserPanel({
  initialUsers,
  viewer,
}: {
  initialUsers: ManagedUser[];
  viewer: Viewer;
}) {
  const { showToast, updateToast } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>(initialUsers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentEditor | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(
    new Set(),
  );
  const [pageSearch, setPageSearch] = useState("");
  const [loadingAssignment, setLoadingAssignment] = useState(false);

  const load = useCallback(async () => {
    const payload = await apiRequest<{ users: ManagedUser[] }>(
      "/api/admin/users",
    );
    setUsers(payload.users);
  }, []);

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((user) => user.approvalStatus === "approved").length,
      pending: users.filter((user) => user.approvalStatus === "pending").length,
      admins: users.filter(
        (user) => user.role === "admin" || user.role === "super_admin",
      ).length,
    }),
    [users],
  );

  async function addEmail(event: React.FormEvent) {
    event.preventDefault();
    const toastId = showToast({
      tone: "loading",
      title: "Đang thêm email vào allowlist",
      description: email,
      duration: null,
    });
    setBusy(true);
    try {
      await apiRequest("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      await load();
      updateToast(toastId, {
        tone: "success",
        title: "Đã thêm email vào allowlist",
        description:
          "Tài khoản có thể đăng nhập bằng Google theo vai trò đã chọn.",
        duration: 5_000,
      });
    } catch (error) {
      updateToast(toastId, {
        tone: "error",
        title: "Không thể thêm email",
        description:
          error instanceof Error ? error.message : "Thao tác thất bại.",
        duration: null,
      });
    } finally {
      setBusy(false);
    }
  }

  async function update(
    userId: string,
    kind: "approval" | "role",
    body: object,
  ) {
    const toastId = showToast({
      tone: "loading",
      title: kind === "role" ? "Đang đổi vai trò" : "Đang cập nhật tài khoản",
      description: "Thay đổi sẽ có hiệu lực ngay sau khi được xác nhận.",
      duration: null,
    });
    setBusy(true);
    try {
      await apiRequest(`/api/admin/users/${userId}/${kind}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
      updateToast(toastId, {
        tone: "success",
        title:
          kind === "role" ? "Đã cập nhật vai trò" : "Đã cập nhật tài khoản",
        description: "Quyền truy cập mới đã có hiệu lực.",
        duration: 5_000,
      });
    } catch (error) {
      updateToast(toastId, {
        tone: "error",
        title: "Không thể cập nhật tài khoản",
        description:
          error instanceof Error ? error.message : "Thao tác thất bại.",
        duration: null,
      });
    } finally {
      setBusy(false);
    }
  }

  async function openAssignments(userId: string) {
    setSelectedUserId(userId);
    setAssignment(null);
    setPageSearch("");
    setLoadingAssignment(true);
    try {
      const payload = await apiRequest<{ assignment: AssignmentEditor }>(
        `/api/admin/users/${userId}/pages`,
      );
      setAssignment(payload.assignment);
      setSelectedPageIds(
        new Set(
          payload.assignment.pages
            .filter((page) => page.assigned)
            .map((page) => page.id),
        ),
      );
    } catch (error) {
      showToast({
        tone: "error",
        title: "Không thể tải phạm vi Page",
        description:
          error instanceof Error ? error.message : "Không thể tải Page.",
      });
      setSelectedUserId(null);
    } finally {
      setLoadingAssignment(false);
    }
  }

  async function saveAssignments() {
    if (!selectedUserId) return;
    const toastId = showToast({
      tone: "loading",
      title: "Đang lưu phân quyền Page",
      description: `${selectedPageIds.size} Page đang được áp dụng.`,
      duration: null,
    });
    setBusy(true);
    try {
      await apiRequest(`/api/admin/users/${selectedUserId}/pages`, {
        method: "PUT",
        body: JSON.stringify({ pageIds: [...selectedPageIds] }),
      });
      await load();
      setSelectedUserId(null);
      updateToast(toastId, {
        tone: "success",
        title: "Đã cập nhật quyền Page",
        description: "Thay đổi có hiệu lực ngay trên giao diện và API.",
        duration: 5_000,
      });
    } catch (error) {
      updateToast(toastId, {
        tone: "error",
        title: "Không thể lưu quyền Page",
        description:
          error instanceof Error ? error.message : "Không thể lưu quyền Page.",
        duration: null,
      });
    } finally {
      setBusy(false);
    }
  }

  const visiblePages = assignment?.pages.filter((page) => {
    const query = pageSearch.trim().toLocaleLowerCase("vi");
    return (
      !query ||
      page.name.toLocaleLowerCase("vi").includes(query) ||
      page.externalPageId.includes(query)
    );
  });

  return (
    <div className="peopleWorkspace">
      <section className="peopleStats" aria-label="Tổng quan nhân sự">
        <article>
          <span>Tài khoản</span>
          <strong>{stats.total}</strong>
          <small>trong hệ thống</small>
        </article>
        <article>
          <span>Đang hoạt động</span>
          <strong>{stats.active}</strong>
          <small>đã được duyệt</small>
        </article>
        <article>
          <span>Chờ duyệt</span>
          <strong>{stats.pending}</strong>
          <small>cần xử lý</small>
        </article>
        <article>
          <span>Quản trị</span>
          <strong>{stats.admins}</strong>
          <small>Admin & Super Admin</small>
        </article>
      </section>

      <div className="peopleLayout">
        <section className="opaqueGlassCard inviteCard">
          <span className="sectionEyebrow">THÊM NHÂN SỰ</span>
          <h2>Mời bằng email Google</h2>
          <p>
            Email được duyệt trước, sau đó đăng nhập bằng Google và chỉ thấy
            Page được cấp.
          </p>
          <form className="allowlistForm" onSubmit={addEmail}>
            <label>
              <span>Email</span>
              <input
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nhansu@congty.com"
                required
                type="email"
                value={email}
              />
            </label>
            <div className="allowlistField">
              <span>Vai trò ban đầu</span>
              <RoleSelect
                ariaLabel="Vai trò ban đầu"
                onChange={setRole}
                options={
                  viewer.role === "super_admin"
                    ? [
                        { value: "member", label: "Nhân viên" },
                        { value: "admin", label: "Admin" },
                      ]
                    : [{ value: "member", label: "Nhân viên" }]
                }
                value={role}
              />
            </div>
            <button className="button" disabled={busy} type="submit">
              Thêm vào allowlist
            </button>
          </form>
          <div className="inviteHint">
            <span>✓</span>
            <p>Không gửi mật khẩu. Facebook token luôn nằm ở server.</p>
          </div>
        </section>

        <section className="opaqueGlassCard peopleDirectory">
          <header>
            <div>
              <span className="sectionEyebrow">DANH SÁCH TRUY CẬP</span>
              <h2>Nhân sự</h2>
            </div>
            <span className="directoryCount">{users.length} tài khoản</span>
          </header>
          <div className="peopleColumnLabels" aria-hidden="true">
            <span>Tài khoản</span>
            <span>Trạng thái</span>
            <span>Vai trò</span>
            <span>Quyền truy cập</span>
          </div>
          <div className="peopleRows">
            {users.map((user) => {
              const protectedUser =
                user.isBootstrapSuperAdmin || user.role === "super_admin";
              const canManage =
                !protectedUser &&
                (viewer.role === "super_admin" || user.role === "member");
              const canManagePages = canManage;
              return (
                <article className="peopleRow" key={user.id}>
                  <div className="userIdentity">
                    <UserAvatar user={user} />
                    <div>
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                    </div>
                  </div>
                  <div className="peopleAccessSummary">
                    <span className={`statusBadge is-${user.approvalStatus}`}>
                      {statusLabels[user.approvalStatus]}
                    </span>
                    <small>
                      {user.role === "super_admin"
                        ? "Toàn bộ"
                        : user.pageAccessCount}{" "}
                      Page
                    </small>
                  </div>
                  <div className="peopleRoleControl">
                    {protectedUser ? (
                      <span className="protectedRole">Super Admin</span>
                    ) : (
                      <RoleSelect
                        ariaLabel={`Vai trò của ${user.email}`}
                        disabled={busy || viewer.role !== "super_admin"}
                        onChange={(nextRole) =>
                          void update(user.id, "role", { role: nextRole })
                        }
                        options={[
                          { value: "member", label: "Nhân viên" },
                          { value: "admin", label: "Admin" },
                        ]}
                        value={user.role as EditableRole}
                      />
                    )}
                  </div>
                  <div className="peopleActions">
                    <button
                      className="pagePermissionButton"
                      disabled={!canManagePages}
                      onClick={() => void openAssignments(user.id)}
                      type="button"
                    >
                      {protectedUser
                        ? "Toàn quyền"
                        : canManagePages
                          ? "Phân quyền Page"
                          : "Không thể cấp"}
                    </button>
                    {canManage ? (
                      <button
                        className="approvalAction"
                        disabled={busy}
                        onClick={() =>
                          void update(user.id, "approval", {
                            status:
                              user.approvalStatus === "approved"
                                ? "suspended"
                                : "approved",
                          })
                        }
                        type="button"
                      >
                        {user.approvalStatus === "approved"
                          ? "Tạm khóa"
                          : "Duyệt"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {selectedUserId ? (
        <div
          className="permissionBackdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy)
              setSelectedUserId(null);
          }}
        >
          <aside
            aria-label="Phân quyền Page"
            aria-modal="true"
            className="permissionDrawer"
            role="dialog"
          >
            <header>
              <div className="permissionUserSummary">
                <span className="permissionUserAvatar">
                  {assignment ? (
                    <UserAvatar user={assignment.user} />
                  ) : (
                    <i aria-hidden="true" />
                  )}
                </span>
                <div>
                  <span className="sectionEyebrow">PHẠM VI PAGE</span>
                  <h2>{assignment?.user.name ?? "Đang tải..."}</h2>
                  <p>{assignment?.user.email}</p>
                </div>
              </div>
              <button
                aria-label="Đóng"
                disabled={busy}
                onClick={() => setSelectedUserId(null)}
                type="button"
              >
                ×
              </button>
            </header>
            {loadingAssignment ? (
              <div className="drawerLoading">Đang tải danh sách Page...</div>
            ) : null}
            {assignment ? (
              <>
                <div className="permissionSearch">
                  <label className="permissionSearchField">
                    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                      <circle cx="8.5" cy="8.5" r="5.25" />
                      <path d="m12.5 12.5 4 4" />
                    </svg>
                    <input
                      aria-label="Tìm Page"
                      onChange={(event) => setPageSearch(event.target.value)}
                      placeholder="Tìm theo tên hoặc Page ID..."
                      value={pageSearch}
                    />
                  </label>
                  <span className="permissionCount">
                    <b>{selectedPageIds.size}</b>/{assignment.pages.length} Page
                  </span>
                </div>
                <div className="permissionPageList">
                  {visiblePages?.map((page) => (
                    <label
                      className={`permissionPage ${!page.canAssign ? "isLocked" : ""}`}
                      key={page.id}
                      title={
                        !page.canAssign
                          ? "Bạn không có quyền cấp Page này"
                          : undefined
                      }
                    >
                      <PageAvatar page={page} />
                      <span>
                        <strong>{page.name}</strong>
                        <small>
                          {page.category ?? "Facebook Page"} ·{" "}
                          {page.externalPageId}
                        </small>
                      </span>
                      {!page.canAssign ? <i aria-hidden="true">🔒</i> : null}
                      <input
                        checked={selectedPageIds.has(page.id)}
                        disabled={!page.canAssign}
                        onChange={(event) =>
                          setSelectedPageIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(page.id);
                            else next.delete(page.id);
                            return next;
                          })
                        }
                        type="checkbox"
                      />
                    </label>
                  ))}
                  {visiblePages?.length === 0 ? (
                    <div className="permissionEmptyState">
                      <strong>Không tìm thấy Page</strong>
                      <span>Thử tên hoặc Page ID khác.</span>
                    </div>
                  ) : null}
                </div>
                <footer>
                  <p>
                    <span aria-hidden="true">✓</span>
                    Thay đổi có hiệu lực ngay trên giao diện và API.
                  </p>
                  <div>
                    <button
                      className="drawerCancel"
                      disabled={busy}
                      onClick={() => setSelectedUserId(null)}
                      type="button"
                    >
                      Hủy
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void saveAssignments()}
                      type="button"
                    >
                      {busy ? "Đang lưu..." : "Lưu phân quyền"}
                    </button>
                  </div>
                </footer>
              </>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
