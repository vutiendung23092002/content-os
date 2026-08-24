"use client";

import Link from "next/link";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useToast } from "@/app/ui/toast-provider";
import {
  addDays,
  getAdaptiveTimelineTop,
  getDayIndexInWeek,
  getTimelineHourLayouts,
  getWeekDays,
  isSameDay,
  startOfWeek,
  TIMELINE_EVENT_GAP,
  TIMELINE_EVENT_HEIGHT,
  TIMELINE_HOUR_PADDING,
} from "./post-view-model";

type PageDto = {
  id: string;
  externalPageId: string;
  name: string;
  avatarUrl: string | null;
  category: string | null;
  connectionStatus: string;
  canAccess: boolean;
  accessReason: string | null;
};

type DraftDto = {
  id: string;
  pageId: string;
  message: string;
  updatedAt: string;
};

type RemotePostDto = {
  remoteId: string;
  kind: "published" | "scheduled";
  message: string;
  effectiveAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  permalinkUrl: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  engagement: {
    reactions: number;
    comments: number;
    shares: number;
  } | null;
  source: "facebook";
};

type PostTab = "drafts" | "scheduled" | "published";
type ViewMode = "table" | "timeline";
type PreviewDevice = "desktop" | "tablet" | "mobile";

const OPERATOR_TIMEZONE = "Asia/Ho_Chi_Minh";
const weekDayFormatter = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
});
const shortDateFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
});
const weekRangeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: OPERATOR_TIMEZONE,
});
const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: OPERATOR_TIMEZONE,
});

async function readPayload<ResponseBody>(response: Response) {
  const payload = (await response.json()) as ResponseBody & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Không thể tải dữ liệu.");
  }
  return payload;
}

function formatDateTime(value: string | null): string {
  return value
    ? dateTimeFormatter.format(new Date(value))
    : "Chưa có thời gian";
}

function excerpt(message: string, length = 96): string {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (!normalized) return "Bài viết không có caption";
  return normalized.length > length
    ? `${normalized.slice(0, length).trim()}…`
    : normalized;
}

function mergePosts(
  current: RemotePostDto[],
  incoming: RemotePostDto[],
): RemotePostDto[] {
  const records = new Map(current.map((post) => [post.remoteId, post]));
  for (const post of incoming) records.set(post.remoteId, post);
  return Array.from(records.values()).sort((first, second) => {
    const firstTime = first.effectiveAt
      ? new Date(first.effectiveAt).getTime()
      : 0;
    const secondTime = second.effectiveAt
      ? new Date(second.effectiveAt).getTime()
      : 0;
    return secondTime - firstTime;
  });
}

type RemoteMemoryCacheEntry = {
  posts: RemotePostDto[];
  after: string | null;
  storedAt: number;
};

const REMOTE_MEMORY_TTL_MS = 5 * 60 * 1000;
const remoteMemoryCache = new Map<string, RemoteMemoryCacheEntry>();

function remoteCacheKey(
  pageId: string,
  tab: Exclude<PostTab, "drafts">,
  mode: ViewMode,
  weekStart: Date,
): string {
  return `${pageId}:${tab}:${mode}:${mode === "timeline" ? weekStart.toISOString() : "latest"}`;
}

function ViewIcon({ mode }: { mode: ViewMode }) {
  return mode === "table" ? (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M3 4.5h14v11H3zM3 8h14M7 4.5v11" />
    </svg>
  ) : (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M3 5.5h14v11H3zM6 3.5v4M14 3.5v4M3 9h14M7.7 12h.1M12.2 12h.1" />
    </svg>
  );
}

const compactNumberFormatter = new Intl.NumberFormat("vi-VN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function EngagementSummary({
  engagement,
  compact = false,
  showLabels = false,
}: {
  engagement: RemotePostDto["engagement"];
  compact?: boolean;
  showLabels?: boolean;
}) {
  if (!engagement) return null;

  const metrics = [
    {
      key: "reactions",
      label: "lượt bày tỏ cảm xúc",
      shortLabel: "Reaction",
      value: engagement.reactions,
      icon: (
        <path d="M7.2 16H4.5V8.8h2.7M7.2 9l2.4-5c.3-.7 1.2-.7 1.5-.1.4.8.3 1.8-.2 3l-.4.9h4.2c1 0 1.7.9 1.5 1.9l-1 4.8c-.2.9-1 1.5-1.9 1.5H7.2V9Z" />
      ),
    },
    {
      key: "comments",
      label: "bình luận",
      shortLabel: "Bình luận",
      value: engagement.comments,
      icon: <path d="M4 4.5h12v8H9l-4 3v-3H4v-8Z" />,
    },
    {
      key: "shares",
      label: "lượt chia sẻ",
      shortLabel: "Chia sẻ",
      value: engagement.shares,
      icon: (
        <path d="m11 5 4 4-4 4v-2.6c-3.3 0-5.4 1-7 3.1.6-4.2 2.7-6.7 7-6.7V5Z" />
      ),
    },
  ] as const;

  return (
    <span className={`engagementSummary ${compact ? "isCompact" : ""}`}>
      {metrics.map((metric) => (
        <span
          aria-label={`${metric.value} ${metric.label}`}
          key={metric.key}
          title={`${metric.value.toLocaleString("vi-VN")} ${metric.label}`}
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
            {metric.icon}
          </svg>
          {compactNumberFormatter.format(metric.value)}
          {showLabels ? ` ${metric.shortLabel}` : null}
        </span>
      ))}
    </span>
  );
}

function PageAvatar({ page }: { page: PageDto }) {
  return page.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" className="pagePickerAvatar" src={page.avatarUrl} />
  ) : (
    <span
      className="pagePickerAvatar pagePickerAvatarFallback"
      aria-hidden="true"
    >
      {page.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function PagePicker({
  pages,
  value,
  disabled,
  onChange,
}: {
  pages: PageDto[];
  value: string;
  disabled: boolean;
  onChange: (pageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedPage = pages.find((page) => page.id === value);

  useEffect(() => {
    function closeWhenClickingOutside(event: MouseEvent) {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        shellRef.current?.contains(document.activeElement)
      ) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", closeWhenClickingOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenClickingOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function focusOption(index: number) {
    const normalized = (index + pages.length) % pages.length;
    optionRefs.current[normalized]?.focus();
  }

  function openAndFocusSelected() {
    setOpen(true);
    window.requestAnimationFrame(() => {
      const selectedIndex = Math.max(
        0,
        pages.findIndex((page) => page.id === value),
      );
      focusOption(selectedIndex);
    });
  }

  return (
    <div className="pagePickerShell" ref={shellRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`pagePickerTrigger ${open ? "isOpen" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openAndFocusSelected();
          }
        }}
        ref={triggerRef}
        type="button"
      >
        {selectedPage ? <PageAvatar page={selectedPage} /> : null}
        <span className="pagePickerTriggerCopy">
          <strong>{selectedPage?.name ?? "Chưa có Page"}</strong>
          <small>{selectedPage?.category ?? "Facebook Page"}</small>
        </span>
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div
          aria-label="Chọn Facebook Page"
          className="pagePickerMenu"
          onKeyDown={(event) => {
            const currentIndex = optionRefs.current.findIndex(
              (option) => option === document.activeElement,
            );
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusOption(currentIndex + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              focusOption(currentIndex - 1);
            } else if (event.key === "Home") {
              event.preventDefault();
              focusOption(0);
            } else if (event.key === "End") {
              event.preventDefault();
              focusOption(pages.length - 1);
            }
          }}
          role="listbox"
        >
          <div className="pagePickerMenuHeader">
            <span>FACEBOOK PAGES</span>
            <small>{pages.length} Page</small>
          </div>
          <div className="pagePickerOptions">
            {pages.map((page, index) => {
              const selected = page.id === value;
              return (
                <button
                  aria-selected={selected}
                  className={`pagePickerOption ${selected ? "isSelected" : ""} ${!page.canAccess ? "isLocked" : ""}`}
                  disabled={!page.canAccess}
                  key={page.id}
                  onClick={() => {
                    onChange(page.id);
                    setOpen(false);
                  }}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  role="option"
                  title={page.accessReason ?? undefined}
                  type="button"
                >
                  <PageAvatar page={page} />
                  <span>
                    <strong>{page.name}</strong>
                    <small>{page.category ?? "Facebook Page"}</small>
                  </span>
                  <i
                    className={
                      page.connectionStatus === "active" ? "isActive" : ""
                    }
                  />
                  <b aria-hidden="true">
                    {!page.canAccess ? "🔒" : selected ? "✓" : ""}
                  </b>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RemotePostTable({ posts }: { posts: RemotePostDto[] }) {
  return (
    <div
      className="remotePostTable"
      role="table"
      aria-label="Bài viết Facebook"
    >
      <div className="remotePostTableHead" role="row">
        <span role="columnheader">Thời gian · tương tác</span>
        <span role="columnheader">Nội dung</span>
        <span role="columnheader">Nguồn</span>
        <span role="columnheader">Trạng thái</span>
        <span aria-hidden="true" />
      </div>
      {posts.map((post) => (
        <article className="remotePostTableRow" key={post.remoteId} role="row">
          <div className="remotePostTimeCell" role="cell">
            <time dateTime={post.effectiveAt ?? undefined}>
              {formatDateTime(post.effectiveAt)}
            </time>
            <EngagementSummary engagement={post.engagement} />
          </div>
          <div className="remotePostContent" role="cell">
            {post.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={post.imageUrl} />
            ) : (
              <span className="remotePostImageFallback" aria-hidden="true">
                Aa
              </span>
            )}
            <div>
              <strong>{excerpt(post.message, 140)}</strong>
              <small>ID {post.remoteId}</small>
            </div>
          </div>
          <span className="facebookSourceBadge" role="cell">
            Facebook
          </span>
          <span
            className={`badge ${
              post.kind === "published" ? "badgeSuccess" : "badgeScheduled"
            }`}
            role="cell"
          >
            {post.kind === "published" ? "Đã đăng" : "Đã hẹn giờ"}
          </span>
          <div className="remotePostLinkCell" role="cell">
            {post.permalinkUrl ? (
              <a
                aria-label="Mở bài viết trên Facebook"
                href={post.permalinkUrl}
                rel="noreferrer"
                target="_blank"
              >
                Mở bài ↗
              </a>
            ) : (
              <span>—</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function TimelineEvent({
  post,
  top,
  onSelect,
}: {
  post: RemotePostDto;
  top: number;
  onSelect: (post: RemotePostDto) => void;
}) {
  const eventDate = new Date(post.effectiveAt!);
  const style = {
    "--event-top": `${top}px`,
  } as CSSProperties;

  return (
    <button
      aria-label={`Xem chi tiết: ${excerpt(post.message, 80)}`}
      className={`timelineEvent timelineEvent${
        post.kind === "published" ? "Published" : "Scheduled"
      }`}
      onClick={() => onSelect(post)}
      style={style}
      type="button"
    >
      <span className="timelineEventHeader">
        <time dateTime={post.effectiveAt ?? undefined}>
          {timeFormatter.format(eventDate)}
        </time>
        <EngagementSummary compact engagement={post.engagement} />
      </span>
      <div>
        {post.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={post.imageUrl} />
        ) : (
          <span aria-hidden="true">Aa</span>
        )}
        <p>{excerpt(post.message, 46)}</p>
      </div>
      <span className="timelineEventPreview" role="tooltip">
        <span>NỘI DUNG BÀI VIẾT</span>
        <strong>{excerpt(post.message, 360)}</strong>
        <small>Nhấn vào card để xem đầy đủ</small>
      </span>
    </button>
  );
}

function PostDetailDialog({
  post,
  page,
  onClose,
}: {
  post: RemotePostDto;
  page: PageDto | undefined;
  onClose: () => void;
}) {
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="postDetailBackdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="post-detail-title"
        aria-modal="true"
        className="postDetailDialog"
        role="dialog"
      >
        <header className="postDetailHeader">
          <div>
            <span
              className={`badge ${
                post.kind === "published" ? "badgeSuccess" : "badgeScheduled"
              }`}
            >
              {post.kind === "published" ? "Đã đăng" : "Đã hẹn giờ"}
            </span>
            <h2 id="post-detail-title">Chi tiết bài viết</h2>
            <p>{page?.name ?? "Facebook Page"}</p>
          </div>
          <div className="postDetailHeaderActions">
            <div
              aria-label="Chọn thiết bị xem trước"
              className="composerPreviewDevices postDetailDevices"
              data-device={previewDevice}
              role="group"
            >
              {(
                [
                  ["desktop", "Desktop"],
                  ["tablet", "Tablet"],
                  ["mobile", "Mobile"],
                ] as const
              ).map(([device, label]) => (
                <button
                  aria-label={`Xem trên ${label}`}
                  aria-pressed={previewDevice === device}
                  className={previewDevice === device ? "isActive" : ""}
                  key={device}
                  onClick={() => setPreviewDevice(device)}
                  title={label}
                  type="button"
                >
                  {device === "desktop" ? (
                    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                      <rect height="11" rx="1.5" width="16" x="2" y="2.5" />
                      <path d="M7 17.5h6M10 13.5v4" />
                    </svg>
                  ) : device === "tablet" ? (
                    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                      <rect height="17" rx="2" width="12" x="4" y="1.5" />
                      <path d="M9 15.8h2" />
                    </svg>
                  ) : (
                    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                      <rect height="17" rx="2" width="9" x="5.5" y="1.5" />
                      <path d="M9 15.8h2" />
                    </svg>
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <button
              aria-label="Đóng chi tiết bài viết"
              autoFocus
              className="postDetailClose"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        <div className="postDetailPreviewBody">
          <div className="postDetailPreviewStage">
            <div
              className={`composerPreviewViewport postDetailPreviewViewport is-${previewDevice}`}
              data-device={previewDevice}
            >
              <div className="composerPreviewDeviceFrame">
                <article className="facebookPostPreview">
                  <div className="facebookPreviewIdentity">
                    {page ? (
                      <PageAvatar page={page} />
                    ) : (
                      <span className="facebookPreviewAvatarFallback" />
                    )}
                    <div>
                      <strong>{page?.name ?? "Facebook Page"}</strong>
                      <small>
                        {formatDateTime(post.effectiveAt)} ·{" "}
                        <span aria-label="Công khai">◉</span>
                      </small>
                    </div>
                    <span aria-hidden="true" className="facebookPreviewMenu">
                      •••
                    </span>
                  </div>
                  <p>{post.message || "Bài viết không có caption."}</p>
                  {post.imageUrls.length > 0 ? (
                    <div
                      className="facebookMediaLayout"
                      data-count={Math.min(post.imageUrls.length, 4)}
                    >
                      {post.imageUrls.slice(0, 4).map((imageUrl, index) => (
                        <div key={`${imageUrl}-${index}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt={`Ảnh ${index + 1} của bài viết`}
                            src={imageUrl}
                          />
                          {index === 3 && post.imageUrls.length > 4 ? (
                            <b>+{post.imageUrls.length - 4}</b>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="postDetailFacebookEngagement">
                    <EngagementSummary
                      engagement={post.engagement}
                      showLabels
                    />
                  </div>
                  <div className="facebookPreviewFooter">
                    <span>
                      <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                        <path d="M6.5 17H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1h2.5M6.5 17h7.2a2 2 0 0 0 1.9-1.4l1.3-4.2a2 2 0 0 0-1.9-2.6h-3.1l.5-2.4A2.8 2.8 0 0 0 9.7 3L6.5 8.5V17Z" />
                      </svg>
                      Thích
                    </span>
                    <span>
                      <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                        <path d="M16.5 9.5a6.5 6.5 0 1 1-3-5.5M7 15.5 4 17l.7-3.4" />
                      </svg>
                      Bình luận
                    </span>
                    <span>
                      <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                        <path d="m11.5 5 5 4.5-5 4.5v-2.7c-4.1 0-6.4 1.2-8 3.2.5-4.4 3-7 8-7V5Z" />
                      </svg>
                      Chia sẻ
                    </span>
                  </div>
                  <div className="facebookPreviewComment">
                    {page ? <PageAvatar page={page} /> : <span />}
                    <span>Viết bình luận...</span>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>

        <footer className="postDetailFooter">
          <span>Chế độ chỉ đọc — không sửa hoặc xoá bài Facebook.</span>
          {post.permalinkUrl ? (
            <a
              aria-label={`Mở bài ${post.remoteId} trên Facebook trong tab mới`}
              className="postDetailPermalink"
              href={post.permalinkUrl}
              rel="noreferrer"
              target="_blank"
              title="Mở bài trên Facebook"
            >
              <span>{post.remoteId}</span>
              <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                <path d="M11 4h5v5" />
                <path d="m16 4-7 7" />
                <path d="M8 6H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
              </svg>
            </a>
          ) : (
            <span className="postDetailPermalink isUnavailable">
              {post.remoteId}
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}

function RemotePostTimeline({
  posts,
  weekStart,
  onWeekChange,
  onPostSelect,
}: {
  posts: RemotePostDto[];
  weekStart: Date;
  onWeekChange: (value: Date) => void;
  onPostSelect: (post: RemotePostDto) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const now = new Date();
  const postsByDay = useMemo(
    () =>
      weekDays.map((_, dayIndex) =>
        posts.filter((post) => {
          if (!post.effectiveAt) return false;
          return (
            getDayIndexInWeek(new Date(post.effectiveAt), weekStart) ===
            dayIndex
          );
        }),
      ),
    [posts, weekDays, weekStart],
  );
  const visibleCount = postsByDay.reduce((total, day) => total + day.length, 0);
  const hasEarlyMorningPost = postsByDay.some((day) =>
    day.some((post) => {
      if (!post.effectiveAt) return false;
      return new Date(post.effectiveAt).getHours() < 7;
    }),
  );
  const visibleStartHour = hasEarlyMorningPost ? 0 : 7;
  const visibleHours = 24 - visibleStartHour;
  const maximumPostsPerHour = useMemo(
    () =>
      Array.from({ length: visibleHours }, (_, hourOffset) => {
        const hour = visibleStartHour + hourOffset;
        return Math.max(
          0,
          ...postsByDay.map(
            (day) =>
              day.filter(
                (post) =>
                  post.effectiveAt &&
                  new Date(post.effectiveAt).getHours() === hour,
              ).length,
          ),
        );
      }),
    [postsByDay, visibleHours, visibleStartHour],
  );
  const hourLayouts = useMemo(
    () => getTimelineHourLayouts(maximumPostsPerHour, visibleStartHour),
    [maximumPostsPerHour, visibleStartHour],
  );
  const timelineHeight = hourLayouts.reduce(
    (height, layout) => height + layout.height,
    0,
  );
  const positionedPostsByDay = useMemo(
    () =>
      postsByDay.map((day) => {
        const slotsByHour = new Map<number, number>();
        return [...day]
          .sort(
            (first, second) =>
              new Date(first.effectiveAt!).getTime() -
              new Date(second.effectiveAt!).getTime(),
          )
          .map((post) => {
            const hour = new Date(post.effectiveAt!).getHours();
            const slot = slotsByHour.get(hour) ?? 0;
            slotsByHour.set(hour, slot + 1);
            const layout = hourLayouts[hour - visibleStartHour];
            return {
              post,
              top:
                (layout?.top ?? 0) +
                TIMELINE_HOUR_PADDING +
                slot * (TIMELINE_EVENT_HEIGHT + TIMELINE_EVENT_GAP),
            };
          });
      }),
    [hourLayouts, postsByDay, visibleStartHour],
  );

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }
  }, [visibleStartHour, weekStart]);

  return (
    <div className="timelineSection">
      <div className="timelineControls">
        <div className="weekNavigator">
          <button
            aria-label="Tuần trước"
            onClick={() => onWeekChange(addDays(weekStart, -7))}
            type="button"
          >
            ‹
          </button>
          <strong>
            {weekRangeFormatter.format(weekStart)} –{" "}
            {weekRangeFormatter.format(addDays(weekStart, 6))}
          </strong>
          <button
            aria-label="Tuần sau"
            onClick={() => onWeekChange(addDays(weekStart, 7))}
            type="button"
          >
            ›
          </button>
          <button
            className="todayButton"
            onClick={() => onWeekChange(startOfWeek(new Date()))}
            type="button"
          >
            Hôm nay
          </button>
        </div>
        <span>{visibleCount} bài trong tuần đang xem</span>
      </div>

      <div className="timelineViewport" ref={viewportRef}>
        <div className="timelineWeekHeader">
          <div className="timelineTimezone">GMT+7</div>
          {weekDays.map((day) => (
            <div
              aria-current={isSameDay(day, now) ? "date" : undefined}
              className={isSameDay(day, now) ? "isToday" : ""}
              key={day.toISOString()}
            >
              <strong>{weekDayFormatter.format(day)}</strong>
              <span>{shortDateFormatter.format(day)}</span>
            </div>
          ))}
        </div>
        <div
          className="timelineCanvas"
          style={
            { "--timeline-height": `${timelineHeight}px` } as CSSProperties
          }
        >
          <div className="timelineTimeColumn">
            {hourLayouts.map((layout) => (
              <time
                dateTime={`${String(layout.hour).padStart(2, "0")}:00`}
                key={layout.hour}
                style={{ "--hour-top": `${layout.top}px` } as CSSProperties}
              >
                {String(layout.hour).padStart(2, "0")}:00
              </time>
            ))}
          </div>
          <div className="timelineHourGrid" aria-hidden="true">
            {hourLayouts.map((layout) => (
              <span
                key={layout.hour}
                style={
                  {
                    "--hour-top": `${layout.top}px`,
                    "--hour-height": `${layout.height}px`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          {visibleCount === 0 ? (
            <div className="timelineEmptyState" role="status">
              <strong>Tuần này chưa có bài viết</strong>
              <span>Dùng nút tuần trước hoặc tuần sau để tiếp tục xem.</span>
            </div>
          ) : null}
          {weekDays.map((day, dayIndex) => (
            <div
              aria-label={
                isSameDay(day, now)
                  ? `${weekDayFormatter.format(day)}, hôm nay`
                  : weekDayFormatter.format(day)
              }
              className={`timelineDayColumn ${
                isSameDay(day, now) ? "isToday" : ""
              }`}
              key={day.toISOString()}
            >
              {positionedPostsByDay[dayIndex]?.map(({ post, top }) => (
                <TimelineEvent
                  key={post.remoteId}
                  onSelect={onPostSelect}
                  post={post}
                  top={top}
                />
              ))}
            </div>
          ))}
          {getDayIndexInWeek(now, weekStart) >= 0 &&
          getDayIndexInWeek(now, weekStart) <= 6 &&
          now.getHours() >= visibleStartHour ? (
            <div
              className="timelineNowLine"
              style={
                {
                  "--now-day": getDayIndexInWeek(now, weekStart) + 2,
                  "--now-top": `${getAdaptiveTimelineTop(
                    now,
                    visibleStartHour,
                    hourLayouts,
                  )}px`,
                } as CSSProperties
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DraftList({ drafts }: { drafts: DraftDto[] }) {
  return (
    <div className="draftList">
      {drafts.map((draft) => (
        <article className="draftCard" key={draft.id}>
          <p>{draft.message}</p>
          <div className="draftMeta">
            Cập nhật {dateTimeFormatter.format(new Date(draft.updatedAt))}
          </div>
        </article>
      ))}
    </div>
  );
}

export function PostWorkspace() {
  const { showToast, updateToast } = useToast();
  const [pages, setPages] = useState<PageDto[]>([]);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [activeTab, setActiveTab] = useState<PostTab>("published");
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [drafts, setDrafts] = useState<DraftDto[]>([]);
  const [remotePosts, setRemotePosts] = useState<RemotePostDto[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [loadingPages, setLoadingPages] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [refreshingPosts, setRefreshingPosts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedPost, setSelectedPost] = useState<RemotePostDto | null>(null);
  const loadedKeyRef = useRef("");
  const forceRefreshRef = useRef(false);
  const refreshToastRef = useRef<string | null>(null);
  const selectedPage = pages.find((page) => page.id === selectedPageId);

  useEffect(() => {
    let active = true;
    void fetch("/api/pages", { headers: { accept: "application/json" } })
      .then((response) => readPayload<{ pages?: PageDto[] }>(response))
      .then((payload) => {
        if (!active) return;
        const loadedPages = payload.pages ?? [];
        setPages(loadedPages);
        setSelectedPageId(
          (current) =>
            current || loadedPages.find((page) => page.canAccess)?.id || "",
        );
      })
      .catch((reason: unknown) => {
        if (active) {
          showToast({
            tone: "error",
            title: "Không thể tải danh sách Page",
            description:
              reason instanceof Error
                ? reason.message
                : "Vui lòng thử lại sau.",
          });
        }
      })
      .finally(() => {
        if (active) setLoadingPages(false);
      });
    return () => {
      active = false;
    };
  }, [showToast]);

  const loadPosts = useCallback(
    async (signal: AbortSignal) => {
      if (!selectedPageId) {
        setDrafts([]);
        setRemotePosts([]);
        setAfter(null);
        setLoadingPosts(false);
        setRefreshingPosts(false);
        return;
      }

      await Promise.resolve();
      if (signal.aborted) return;
      const timelineKey =
        viewMode === "timeline" ? `:${weekStart.toISOString()}` : "";
      const requestKey = `${selectedPageId}:${activeTab}:${viewMode}${timelineKey}`;
      const forceRefresh = forceRefreshRef.current;
      forceRefreshRef.current = false;
      setLoadFailed(false);
      const cacheKey =
        activeTab === "drafts"
          ? null
          : remoteCacheKey(selectedPageId, activeTab, viewMode, weekStart);
      const memoryEntry = cacheKey
        ? remoteMemoryCache.get(cacheKey)
        : undefined;
      const memoryIsFresh =
        memoryEntry &&
        Date.now() - memoryEntry.storedAt <= REMOTE_MEMORY_TTL_MS;

      if (memoryEntry) {
        setDrafts([]);
        setRemotePosts(memoryEntry.posts);
        setAfter(memoryEntry.after);
        loadedKeyRef.current = requestKey;
      } else if (loadedKeyRef.current !== requestKey) {
        setDrafts([]);
        setRemotePosts([]);
        setAfter(null);
      }

      if (memoryIsFresh && !forceRefresh) {
        setLoadingPosts(false);
        setRefreshingPosts(false);
        return;
      }

      setLoadingPosts(!memoryEntry);
      setRefreshingPosts(Boolean(memoryEntry));

      try {
        if (activeTab === "drafts") {
          const response = await fetch(
            `/api/posts?pageId=${encodeURIComponent(selectedPageId)}`,
            { headers: { accept: "application/json" }, signal },
          );
          const payload = await readPayload<{ drafts?: DraftDto[] }>(response);
          setDrafts(payload.drafts ?? []);
          setRemotePosts([]);
          loadedKeyRef.current = requestKey;
          if (refreshToastRef.current) {
            updateToast(refreshToastRef.current, {
              tone: "success",
              title: "Đã làm mới bài viết",
              description: "Dữ liệu mới nhất đã được tải về.",
              duration: 4_000,
            });
            refreshToastRef.current = null;
          }
          return;
        }

        const query = new URLSearchParams({
          pageId: selectedPageId,
          kind: activeTab,
        });
        if (viewMode === "timeline") {
          query.set("weekStart", weekStart.toISOString());
          if (forceRefresh) query.set("refresh", "1");
        }
        const response = await fetch(`/api/facebook/posts?${query}`, {
          headers: { accept: "application/json" },
          signal,
        });
        const payload = await readPayload<{
          posts?: RemotePostDto[];
          after?: string | null;
          stale?: boolean;
        }>(response);
        const loadedPosts = mergePosts([], payload.posts ?? []);
        const nextAfter = payload.after ?? null;

        setRemotePosts(loadedPosts);
        setDrafts([]);
        setAfter(nextAfter);
        loadedKeyRef.current = requestKey;
        if (cacheKey) {
          remoteMemoryCache.set(cacheKey, {
            posts: loadedPosts,
            after: nextAfter,
            storedAt: payload.stale ? 0 : Date.now(),
          });
        }

        if (viewMode === "timeline" && payload.stale && !forceRefresh) {
          setLoadingPosts(false);
          setRefreshingPosts(true);
          query.set("refresh", "1");
          const refreshedResponse = await fetch(
            `/api/facebook/posts?${query}`,
            { headers: { accept: "application/json" }, signal },
          );
          const refreshedPayload = await readPayload<{
            posts?: RemotePostDto[];
          }>(refreshedResponse);
          const refreshedPosts = mergePosts([], refreshedPayload.posts ?? []);
          setRemotePosts(refreshedPosts);
          if (cacheKey) {
            remoteMemoryCache.set(cacheKey, {
              posts: refreshedPosts,
              after: null,
              storedAt: Date.now(),
            });
          }
        }
        if (refreshToastRef.current) {
          updateToast(refreshToastRef.current, {
            tone: "success",
            title: "Đã làm mới bài viết",
            description: "Dữ liệu mới nhất từ Facebook đã được tải về.",
            duration: 4_000,
          });
          refreshToastRef.current = null;
        }
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        const description =
          reason instanceof Error ? reason.message : "Không thể tải bài viết.";
        setLoadFailed(true);
        if (refreshToastRef.current) {
          updateToast(refreshToastRef.current, {
            tone: "error",
            title: "Không thể làm mới bài viết",
            description,
            duration: null,
          });
          refreshToastRef.current = null;
        } else {
          showToast({
            tone: "error",
            title: "Không thể tải bài viết",
            description,
          });
        }
        if (loadedKeyRef.current !== requestKey) {
          setDrafts([]);
          setRemotePosts([]);
        }
      } finally {
        if (!signal.aborted) {
          setLoadingPosts(false);
          setRefreshingPosts(false);
        }
      }
    },
    [activeTab, selectedPageId, showToast, updateToast, viewMode, weekStart],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void loadPosts(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [loadPosts, refreshIndex]);

  async function loadMore() {
    if (!after || activeTab === "drafts" || !selectedPageId) return;
    const toastId = showToast({
      tone: "loading",
      title: "Đang tải thêm bài viết",
      description: "Đang đọc trang dữ liệu tiếp theo từ Facebook.",
      duration: null,
    });
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({
        pageId: selectedPageId,
        kind: activeTab,
        after,
      });
      const response = await fetch(`/api/facebook/posts?${query}`, {
        headers: { accept: "application/json" },
      });
      const payload = await readPayload<{
        posts?: RemotePostDto[];
        after?: string | null;
        fetchedAt?: string;
      }>(response);
      const nextAfter = payload.after ?? null;
      setRemotePosts((current) => {
        const merged = mergePosts(current, payload.posts ?? []);
        remoteMemoryCache.set(
          remoteCacheKey(selectedPageId, activeTab, "table", weekStart),
          { posts: merged, after: nextAfter, storedAt: Date.now() },
        );
        return merged;
      });
      setAfter(nextAfter);
      updateToast(toastId, {
        tone: "success",
        title: "Đã tải thêm bài viết",
        description: `${payload.posts?.length ?? 0} bài viết đã được thêm vào bảng.`,
        duration: 4_000,
      });
    } catch (reason) {
      updateToast(toastId, {
        tone: "error",
        title: "Không thể tải thêm bài viết",
        description:
          reason instanceof Error ? reason.message : "Vui lòng thử lại sau.",
        duration: null,
      });
    } finally {
      setLoadingMore(false);
    }
  }

  const isRemoteTab = activeTab !== "drafts";
  const hasAccessiblePage = pages.some((page) => page.canAccess);
  const empty =
    activeTab === "drafts" ? drafts.length === 0 : remotePosts.length === 0;

  return (
    <div className="pageStack postWorkspaceStack">
      <section className="surfaceCard postLibraryCard">
        <div className="postLibraryToolbar">
          <div
            className="contentTabs"
            role="tablist"
            aria-label="Trạng thái bài viết"
          >
            <button
              aria-selected={activeTab === "drafts"}
              className={activeTab === "drafts" ? "isActive" : ""}
              onClick={() => setActiveTab("drafts")}
              role="tab"
              type="button"
            >
              Bản nháp
            </button>
            <button
              aria-selected={activeTab === "scheduled"}
              className={activeTab === "scheduled" ? "isActive" : ""}
              onClick={() => setActiveTab("scheduled")}
              role="tab"
              type="button"
            >
              Đã hẹn giờ
            </button>
            <button
              aria-selected={activeTab === "published"}
              className={activeTab === "published" ? "isActive" : ""}
              onClick={() => setActiveTab("published")}
              role="tab"
              type="button"
            >
              Đã đăng
            </button>
          </div>

          <div className="postLibraryActions">
            <div className="pagePickerField postLibraryPagePicker">
              <PagePicker
                disabled={loadingPages || pages.length === 0}
                onChange={setSelectedPageId}
                pages={pages}
                value={selectedPageId}
              />
            </div>

            {isRemoteTab ? (
              <div
                className="viewModeSwitch"
                aria-label="Kiểu hiển thị"
                data-mode={viewMode}
              >
                {(["table", "timeline"] as const).map((mode) => (
                  <button
                    aria-label={
                      mode === "table"
                        ? "Hiển thị dạng bảng"
                        : "Hiển thị timeline"
                    }
                    aria-pressed={viewMode === mode}
                    className={viewMode === mode ? "isActive" : ""}
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    type="button"
                  >
                    <ViewIcon mode={mode} />
                    {mode === "table" ? "Bảng" : "Timeline"}
                  </button>
                ))}
              </div>
            ) : null}

            <button
              aria-label={
                loadingPosts || refreshingPosts
                  ? "Đang làm mới bài viết"
                  : "Làm mới bài viết"
              }
              className={`refreshPostsButton ${
                loadingPosts || refreshingPosts ? "isLoading" : ""
              }`}
              disabled={!selectedPageId || loadingPosts || refreshingPosts}
              onClick={() => {
                refreshToastRef.current = showToast({
                  tone: "loading",
                  title: "Đang làm mới bài viết",
                  description: "Đang lấy dữ liệu mới nhất từ Facebook.",
                  duration: null,
                });
                forceRefreshRef.current = true;
                setRefreshIndex((current) => current + 1);
              }}
              title={
                loadingPosts || refreshingPosts
                  ? "Đang làm mới"
                  : "Làm mới bài viết"
              }
              type="button"
            >
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8" />
                <path d="M20 3v5h-5" />
              </svg>
            </button>
          </div>
        </div>

        {!loadingPages && pages.length === 0 ? (
          <div className="emptyState">
            <strong>Chưa có Facebook Page</strong>
            <p>Thêm Page bằng ID trước khi đọc danh sách bài viết.</p>
            <Link className="button" href="/pages">
              Quản lý Pages
            </Link>
          </div>
        ) : null}
        {!loadingPages && pages.length > 0 && !hasAccessiblePage ? (
          <div className="emptyState">
            <strong>Bạn chưa được cấp Page</strong>
            <p>Liên hệ Admin để được gán Page trước khi xem hoặc soạn bài.</p>
          </div>
        ) : null}
        {loadingPosts ? (
          <div className="postLoadingState" role="status">
            <span /> Đang đọc dữ liệu{" "}
            {activeTab === "drafts" ? "nội bộ" : "từ Facebook"}...
          </div>
        ) : null}
        {!loadingPosts &&
        selectedPageId &&
        empty &&
        !loadFailed &&
        !(isRemoteTab && viewMode === "timeline") ? (
          <div className="emptyState">
            <strong>
              {activeTab === "drafts"
                ? "Chưa có bản nháp"
                : activeTab === "published"
                  ? "Facebook chưa trả về bài đã đăng"
                  : "Facebook chưa trả về bài hẹn giờ"}
            </strong>
            <p>Không có dữ liệu giả được thêm vào màn hình này.</p>
          </div>
        ) : null}

        {!loadingPosts && activeTab === "drafts" && drafts.length > 0 ? (
          <DraftList drafts={drafts} />
        ) : null}
        {!loadingPosts &&
        isRemoteTab &&
        remotePosts.length > 0 &&
        viewMode === "table" ? (
          <RemotePostTable posts={remotePosts} />
        ) : null}
        {!loadingPosts && isRemoteTab && viewMode === "timeline" ? (
          <RemotePostTimeline
            onWeekChange={setWeekStart}
            onPostSelect={setSelectedPost}
            posts={remotePosts}
            weekStart={weekStart}
          />
        ) : null}

        {!loadingPosts && isRemoteTab && viewMode === "table" && after ? (
          <div className="loadMoreRow">
            <button
              className="button buttonSecondary"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {loadingMore ? "Đang tải thêm..." : "Tải thêm từ Facebook"}
            </button>
          </div>
        ) : null}
      </section>
      {selectedPost ? (
        <PostDetailDialog
          onClose={() => setSelectedPost(null)}
          page={selectedPage}
          post={selectedPost}
        />
      ) : null}
    </div>
  );
}
