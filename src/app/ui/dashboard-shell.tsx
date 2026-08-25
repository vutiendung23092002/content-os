"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type IconName =
  | "write"
  | "posts"
  | "pages"
  | "calendar"
  | "settings"
  | "help"
  | "menu"
  | "chevron";

type Account = {
  id: string;
  name: string;
  avatarUrl?: string;
};

type SessionViewer = {
  name: string;
  email: string;
  avatarUrl?: string;
  role: "super_admin" | "admin" | "member";
};

type NavIndicatorGeometry = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type PendingNavigation = {
  fromPathname: string;
  key: string;
};

const roleLabels: Record<SessionViewer["role"], string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  member: "Nhân viên",
};

const navGroups: Array<{
  label: string;
  items: Array<{
    href: string;
    label: string;
    icon: IconName;
    match?: (pathname: string) => boolean;
  }>;
}> = [
  {
    label: "Nội dung",
    items: [
      {
        href: "/posts",
        label: "Bài viết",
        icon: "posts",
        match: (pathname) => pathname === "/posts",
      },
    ],
  },
  {
    label: "Quản trị",
    items: [
      { href: "/pages", label: "Facebook Pages", icon: "pages" },
      { href: "/admin", label: "Nhân sự", icon: "settings" },
    ],
  },
  {
    label: "Hỗ trợ",
    items: [
      {
        href: "/guide",
        label: "Hướng dẫn nhanh",
        icon: "help",
      },
    ],
  },
];

const pageTitles: Record<string, { eyebrow: string; title: string }> = {
  "/pages": { eyebrow: "Quản trị", title: "Facebook Pages" },
  "/posts": { eyebrow: "Nội dung", title: "Bài viết" },
  "/posts/new": { eyebrow: "Nội dung", title: "Soạn bài mới" },
  "/admin": { eyebrow: "Quản trị", title: "Nhân sự" },
  "/guide": { eyebrow: "Hỗ trợ", title: "Hướng dẫn nhanh" },
};

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    write: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    posts: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    pages: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.7 9a2.4 2.4 0 1 1 3.7 2c-.9.6-1.4 1.1-1.4 2" />
        <path d="M12 17h.01" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    chevron: <path d="m9 18 6-6-6-6" />,
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        {paths[name]}
      </g>
    </svg>
  );
}

function isItemActive(
  pathname: string,
  item: (typeof navGroups)[number]["items"][number],
) {
  if (item.match) return item.match(pathname);
  return pathname.startsWith(item.href);
}

function navItemKey(groupLabel: string, itemLabel: string) {
  return `${groupLabel}-${itemLabel}`;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [viewer, setViewer] = useState<SessionViewer | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const sidebarNavRef = useRef<HTMLElement>(null);
  const sidebarNavItemRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [navIndicatorGeometry, setNavIndicatorGeometry] =
    useState<NavIndicatorGeometry | null>(null);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);
  const isBarePage = pathname === "/login" || pathname === "/access-pending";
  const heading = pageTitles[pathname] ?? pageTitles["/posts"]!;
  const activeNavItem = navGroups
    .flatMap((group) =>
      group.items.map((item) => ({
        groupLabel: group.label,
        item,
      })),
    )
    .filter(({ item }) => item.href !== "/admin" || viewer?.role !== "member")
    .find(({ item }) => isItemActive(pathname, item));
  const activeNavKey = activeNavItem
    ? navItemKey(activeNavItem.groupLabel, activeNavItem.item.label)
    : null;
  const indicatorNavKey =
    pendingNavigation?.fromPathname === pathname
      ? pendingNavigation.key
      : activeNavKey;

  useLayoutEffect(() => {
    const nav = sidebarNavRef.current;
    const activeItem = indicatorNavKey
      ? sidebarNavItemRefs.current.get(indicatorNavKey)
      : null;

    if (!nav || !activeItem) {
      setNavIndicatorGeometry(null);
      return;
    }

    const updateGeometry = () => {
      const navRect = nav.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();

      setNavIndicatorGeometry({
        height: itemRect.height,
        width: itemRect.width,
        x: itemRect.left - navRect.left + nav.scrollLeft,
        y: itemRect.top - navRect.top + nav.scrollTop,
      });
    };

    updateGeometry();

    const resizeObserver = new ResizeObserver(updateGeometry);
    resizeObserver.observe(nav);
    resizeObserver.observe(activeItem);
    window.addEventListener("resize", updateGeometry);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateGeometry);
    };
  }, [indicatorNavKey, viewer?.role]);

  useEffect(() => {
    if (isBarePage) return;

    let active = true;

    void fetch("/api/facebook/status", {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          connection?: { account?: Account } | null;
        };
        if (active && response.ok) {
          setAccount(payload.connection?.account ?? null);
        }
      })
      .catch(() => {
        if (active) setAccount(null);
      })
      .finally(() => {
        if (active) setAccountReady(true);
      });

    void fetch("/api/auth/session", { headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = (await response.json()) as { viewer?: SessionViewer };
        if (active && response.ok) setViewer(payload.viewer ?? null);
      })
      .catch(() => {
        if (active) setViewer(null);
      });

    return () => {
      active = false;
    };
  }, [isBarePage]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  if (isBarePage) return <>{children}</>;

  const isPostLibraryPage = pathname === "/posts";

  return (
    <div
      className={`dashboardFrame ${
        isPostLibraryPage ? "isPostLibraryFrame" : ""
      }`}
    >
      <button
        aria-label="Đóng menu"
        className={`sidebarBackdrop ${sidebarOpen ? "isVisible" : ""}`}
        onClick={() => setSidebarOpen(false)}
        type="button"
      />
      <aside className={`sidebar ${sidebarOpen ? "isOpen" : ""}`}>
        <Link
          className="wordmark"
          href="/posts"
          onClick={() => setSidebarOpen(false)}
        >
          <span className="wordmarkMark" aria-hidden="true">
            H
          </span>
          <span>
            <strong>HanContent</strong>
            <small>Content OS</small>
          </span>
        </Link>

        <Link
          className="primaryCreateButton"
          href="/posts/new"
          onClick={() => setSidebarOpen(false)}
        >
          <Icon name="write" />
          Viết bài mới
        </Link>

        <nav
          className="sidebarNav"
          aria-label="Điều hướng chính"
          ref={sidebarNavRef}
        >
          <span
            aria-hidden="true"
            className={`sidebarNavIndicator ${
              navIndicatorGeometry ? "isReady" : ""
            }`}
            style={
              navIndicatorGeometry
                ? {
                    height: navIndicatorGeometry.height,
                    transform: `translate3d(${navIndicatorGeometry.x}px, ${navIndicatorGeometry.y}px, 0)`,
                    width: navIndicatorGeometry.width,
                  }
                : undefined
            }
          />
          {navGroups.map((group) => (
            <div className="navGroup" key={group.label}>
              <p>{group.label}</p>
              {group.items
                .filter(
                  (item) => item.href !== "/admin" || viewer?.role !== "member",
                )
                .map((item) => {
                  const active = isItemActive(pathname, item);
                  const itemKey = navItemKey(group.label, item.label);
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={`navItem ${active ? "isActive" : ""}`}
                      href={item.href}
                      key={itemKey}
                      onClick={(event) => {
                        const isPrimaryClick =
                          event.button === 0 &&
                          !event.altKey &&
                          !event.ctrlKey &&
                          !event.metaKey &&
                          !event.shiftKey;
                        if (isPrimaryClick && isItemActive(item.href, item)) {
                          setPendingNavigation({
                            fromPathname: pathname,
                            key: itemKey,
                          });
                        }
                        setSidebarOpen(false);
                      }}
                      ref={(element) => {
                        if (element) {
                          sidebarNavItemRefs.current.set(itemKey, element);
                        } else {
                          sidebarNavItemRefs.current.delete(itemKey);
                        }
                      }}
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>

        <div className="sidebarFooter">
          <span className={account ? "statusDot" : "statusDot isMuted"} />
          Meta Graph API
          <strong>
            {!accountReady
              ? "Đang kiểm tra"
              : account
                ? "Đã kết nối"
                : "Cần kiểm tra"}
          </strong>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspaceTopbar">
          <div className="topbarHeading">
            <button
              aria-label="Mở menu"
              className="menuButton"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <Icon name="menu" />
            </button>
            <div>
              <span>{heading.eyebrow}</span>
              <strong>{heading.title}</strong>
            </div>
          </div>

          <div className="topAccountShell" ref={accountMenuRef}>
            <button
              aria-controls="account-menu"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              aria-label={`Mở menu tài khoản ${viewer?.name ?? "Google"}`}
              className={`topAccount ${accountMenuOpen ? "isOpen" : ""}`}
              onClick={() => setAccountMenuOpen((current) => !current)}
              title={viewer?.name ?? "Tài khoản Google"}
              type="button"
            >
              {viewer?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={viewer.avatarUrl} />
              ) : (
                <span className="topAccountAvatar" aria-hidden="true">
                  {viewer?.name.slice(0, 1).toUpperCase() ?? "G"}
                </span>
              )}
            </button>

            {accountMenuOpen ? (
              <div className="accountMenu" id="account-menu" role="menu">
                <div className="accountMenuIdentity">
                  {viewer?.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={viewer.avatarUrl} />
                  ) : (
                    <span aria-hidden="true">
                      {viewer?.name.slice(0, 1).toUpperCase() ?? "G"}
                    </span>
                  )}
                  <div>
                    <strong>{viewer?.name ?? "Tài khoản Google"}</strong>
                    <small>{viewer?.email ?? "Đang tải thông tin..."}</small>
                    {viewer ? <b>{roleLabels[viewer.role]}</b> : null}
                  </div>
                </div>

                {viewer?.role !== "member" ? (
                  <Link
                    className="accountMenuItem"
                    href="/admin"
                    onClick={() => setAccountMenuOpen(false)}
                    role="menuitem"
                  >
                    <Icon name="settings" />
                    <span>
                      <strong>Nhân sự & phân quyền</strong>
                      <small>Quản lý tài khoản được phép truy cập</small>
                    </span>
                  </Link>
                ) : null}

                <form
                  action="/api/auth/logout"
                  method="post"
                  onSubmit={(event) => {
                    const draftMessage =
                      pathname === "/posts/new"
                        ? document.querySelector<HTMLTextAreaElement>(
                            "#message",
                          )?.value
                        : "";
                    if (
                      draftMessage?.trim() &&
                      !window.confirm(
                        "Bạn có nội dung chưa lưu. Vẫn đăng xuất?",
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <button
                    className="accountLogoutButton"
                    role="menuitem"
                    type="submit"
                  >
                    <span aria-hidden="true">↪</span>
                    Đăng xuất
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </header>
        <div className="workspaceContent">{children}</div>
      </div>
    </div>
  );
}
