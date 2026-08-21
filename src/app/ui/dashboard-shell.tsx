"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

type IconName =
  | "home"
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
      { href: "/", label: "Tổng quan", icon: "home" },
      {
        href: "/posts",
        label: "Bài viết",
        icon: "posts",
        match: (pathname) => pathname === "/posts",
      },
      {
        href: "/posts/new",
        label: "Soạn bài",
        icon: "write",
      },
    ],
  },
  {
    label: "Quản trị",
    items: [{ href: "/pages", label: "Facebook Pages", icon: "pages" }],
  },
  {
    label: "Hỗ trợ",
    items: [
      {
        href: "/",
        label: "Hướng dẫn nhanh",
        icon: "help",
        match: () => false,
      },
    ],
  },
];

const pageTitles: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "Không gian làm việc", title: "Tổng quan" },
  "/pages": { eyebrow: "Quản trị", title: "Facebook Pages" },
  "/posts": { eyebrow: "Nội dung", title: "Bài viết" },
  "/posts/new": { eyebrow: "Nội dung", title: "Soạn bài mới" },
};

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
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
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const heading = pageTitles[pathname] ?? pageTitles["/"]!;

  useEffect(() => {
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

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="dashboardFrame">
      <button
        aria-label="Đóng menu"
        className={`sidebarBackdrop ${sidebarOpen ? "isVisible" : ""}`}
        onClick={() => setSidebarOpen(false)}
        type="button"
      />
      <aside className={`sidebar ${sidebarOpen ? "isOpen" : ""}`}>
        <Link
          className="wordmark"
          href="/"
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

        <nav className="sidebarNav" aria-label="Điều hướng chính">
          {navGroups.map((group) => (
            <div className="navGroup" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => {
                const active = isItemActive(pathname, item);
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`navItem ${active ? "isActive" : ""}`}
                    href={item.href}
                    key={`${group.label}-${item.label}`}
                    onClick={() => setSidebarOpen(false)}
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

          <Link className="topAccount" href="/pages">
            {account?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={account.avatarUrl} />
            ) : (
              <span className="topAccountAvatar" aria-hidden="true">
                {account?.name.slice(0, 1).toUpperCase() ?? "F"}
              </span>
            )}
            <span className="topAccountText">
              <small>Tài khoản Facebook</small>
              <strong>
                {!accountReady
                  ? "Đang kiểm tra..."
                  : (account?.name ?? "Chưa kết nối")}
              </strong>
            </span>
            <Icon name="chevron" />
          </Link>
        </header>
        <div className="workspaceContent">{children}</div>
      </div>
    </div>
  );
}
