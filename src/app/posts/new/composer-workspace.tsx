"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type PageDto = {
  id: string;
  externalPageId: string;
  name: string;
  avatarUrl: string | null;
  category: string | null;
  timezone: string | null;
  connectionStatus: string;
  canAccess: boolean;
  accessReason: string | null;
};

type LocalMedia = {
  localId: string;
  file: File;
  previewUrl: string;
};

type PublishMode = "now" | "schedule";
type PendingAction = "publish" | "schedule" | null;
type PreviewDevice = "desktop" | "tablet" | "mobile";

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function readPayload<ResponseBody>(response: Response) {
  type Payload = ResponseBody & {
    error?: { message?: string };
    detail?: string;
    message?: string;
    title?: string;
  };
  const responseText = await response.text();
  let payload: Payload | null = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as Payload;
    } catch {
      const endpoint = response.url
        ? new URL(response.url).pathname
        : "API nội bộ";
      throw new Error(
        `${endpoint} trả về dữ liệu không hợp lệ (${response.status}). Vui lòng thử lại hoặc kiểm tra server.`,
      );
    }
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ??
        payload?.detail ??
        payload?.message ??
        payload?.title ??
        `Không thể hoàn tất thao tác (${response.status}).`,
    );
  }
  if (!payload) {
    throw new Error("Máy chủ không trả về dữ liệu xác nhận thao tác.");
  }
  return payload;
}

function PageAvatar({ page }: { page: PageDto }) {
  return page.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" className="pagePickerAvatar" src={page.avatarUrl} />
  ) : (
    <span
      aria-hidden="true"
      className="pagePickerAvatar pagePickerAvatarFallback"
    >
      {page.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ComposerPagePicker({
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
      if (event.key === "Escape" && open) {
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
  }, [open]);

  function focusOption(index: number) {
    const normalized = (index + pages.length) % pages.length;
    optionRefs.current[normalized]?.focus();
  }

  return (
    <div className="pagePickerShell composerPagePicker" ref={shellRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`pagePickerTrigger ${open ? "isOpen" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            window.requestAnimationFrame(() => {
              focusOption(
                Math.max(
                  0,
                  pages.findIndex((page) => page.id === value),
                ),
              );
            });
          }
        }}
        ref={triggerRef}
        type="button"
      >
        {selectedPage ? <PageAvatar page={selectedPage} /> : null}
        <span className="pagePickerTriggerCopy">
          <strong>{selectedPage?.name ?? "Chọn Facebook Page"}</strong>
          <small>{selectedPage?.category ?? "Chưa có Page khả dụng"}</small>
        </span>
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div
          aria-label="Chọn Facebook Page"
          className="pagePickerMenu composerPagePickerMenu"
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

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function minimumScheduleValue(referenceTime: number) {
  // datetime-local drops seconds, so keep a one-minute UI buffer above
  // Facebook's 20-minute minimum instead of offering an immediately-invalid value.
  const date = new Date(referenceTime + 21 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function maximumScheduleValue(referenceTime: number) {
  const date = new Date(referenceTime + 29 * 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toLocalDateTimeValue(date: Date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 16);
}

function formatScheduleLabel(value: string) {
  if (!value) return "Chọn lịch đăng";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chọn lịch đăng";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function LiquidDateTimePicker({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: string;
  min: string;
  max: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value || min);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = new Date(value || min);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const shellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const minDate = new Date(min);
  const maxDate = new Date(max);
  const selectedDate = new Date(draftValue || min);

  useEffect(() => {
    function closeWhenClickingOutside(event: MouseEvent) {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
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
  }, [open]);

  function clampDate(date: Date) {
    const timestamp = Math.min(
      maxDate.getTime(),
      Math.max(minDate.getTime(), date.getTime()),
    );
    return new Date(timestamp);
  }

  function openPicker() {
    const nextValue = value || min;
    const nextDate = new Date(nextValue);
    setDraftValue(nextValue);
    setVisibleMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    setOpen(true);
  }

  function chooseDay(day: Date) {
    const next = new Date(day);
    next.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
    setDraftValue(toLocalDateTimeValue(clampDate(next)));
  }

  function updateTime(part: "hour" | "minute", rawValue: string) {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed)) return;
    const next = new Date(selectedDate);
    if (part === "hour") {
      next.setHours(Math.min(23, Math.max(0, parsed)));
    } else {
      next.setMinutes(Math.min(59, Math.max(0, parsed)));
    }
    setDraftValue(toLocalDateTimeValue(clampDate(next)));
  }

  const firstDay = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    1,
  );
  const calendarStart = new Date(firstDay);
  calendarStart.setDate(firstDay.getDate() - firstDay.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(calendarStart);
    day.setDate(calendarStart.getDate() + index);
    return day;
  });
  const previousMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() - 1,
    1,
  );
  const nextMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    1,
  );
  const canGoPrevious =
    previousMonth.getFullYear() > minDate.getFullYear() ||
    (previousMonth.getFullYear() === minDate.getFullYear() &&
      previousMonth.getMonth() >= minDate.getMonth());
  const canGoNext =
    nextMonth.getFullYear() < maxDate.getFullYear() ||
    (nextMonth.getFullYear() === maxDate.getFullYear() &&
      nextMonth.getMonth() <= maxDate.getMonth());

  return (
    <div className="liquidDateTimePicker" ref={shellRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`liquidDateTrigger ${value ? "hasValue" : ""} ${open ? "isOpen" : ""}`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPicker())}
        ref={triggerRef}
        type="button"
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M5 2.5v3M15 2.5v3M3 7.5h14M4.5 4h11A1.5 1.5 0 0 1 17 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-10A1.5 1.5 0 0 1 4.5 4Z" />
        </svg>
        <span>{formatScheduleLabel(value)}</span>
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div
          aria-label="Chọn ngày và giờ đăng Facebook"
          className="liquidDatePopover"
          role="dialog"
        >
          <div className="liquidCalendarHeader">
            <div>
              <span>LỊCH ĐĂNG</span>
              <strong>
                {new Intl.DateTimeFormat("vi-VN", {
                  month: "long",
                  year: "numeric",
                }).format(visibleMonth)}
              </strong>
            </div>
            <div>
              <button
                aria-label="Tháng trước"
                disabled={!canGoPrevious}
                onClick={() => setVisibleMonth(previousMonth)}
                type="button"
              >
                ‹
              </button>
              <button
                aria-label="Tháng sau"
                disabled={!canGoNext}
                onClick={() => setVisibleMonth(nextMonth)}
                type="button"
              >
                ›
              </button>
            </div>
          </div>

          <div className="liquidCalendarWeekdays" aria-hidden="true">
            {["CN", "T2", "T3", "T4", "T5", "T6", "T7"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="liquidCalendarGrid">
            {calendarDays.map((day) => {
              const dayStart = new Date(day);
              dayStart.setHours(0, 0, 0, 0);
              const dayEnd = new Date(day);
              dayEnd.setHours(23, 59, 59, 999);
              const unavailable = dayEnd < minDate || dayStart > maxDate;
              const selected =
                day.getFullYear() === selectedDate.getFullYear() &&
                day.getMonth() === selectedDate.getMonth() &&
                day.getDate() === selectedDate.getDate();
              const outsideMonth = day.getMonth() !== visibleMonth.getMonth();
              return (
                <button
                  aria-pressed={selected}
                  className={`${selected ? "isSelected" : ""} ${outsideMonth ? "isOutside" : ""}`}
                  disabled={unavailable}
                  key={day.toISOString()}
                  onClick={() => chooseDay(day)}
                  type="button"
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="liquidTimeRow">
            <div>
              <span>GIỜ ĐĂNG</span>
              <strong>Giờ Việt Nam</strong>
            </div>
            <label>
              <span className="srOnly">Giờ</span>
              <input
                inputMode="numeric"
                max="23"
                min="0"
                onChange={(event) => updateTime("hour", event.target.value)}
                type="number"
                value={String(selectedDate.getHours()).padStart(2, "0")}
              />
            </label>
            <b>:</b>
            <label>
              <span className="srOnly">Phút</span>
              <input
                inputMode="numeric"
                max="59"
                min="0"
                onChange={(event) => updateTime("minute", event.target.value)}
                type="number"
                value={String(selectedDate.getMinutes()).padStart(2, "0")}
              />
            </label>
          </div>

          <div className="liquidCalendarActions">
            <button
              className="liquidCalendarSoonest"
              onClick={() => {
                const next = new Date(min);
                setDraftValue(min);
                setVisibleMonth(
                  new Date(next.getFullYear(), next.getMonth(), 1),
                );
              }}
              type="button"
            >
              Sớm nhất
            </button>
            <div>
              <button onClick={() => setOpen(false)} type="button">
                Hủy
              </button>
              <button
                className="liquidCalendarApply"
                onClick={() => {
                  onChange(draftValue);
                  setOpen(false);
                }}
                type="button"
              >
                Chọn lịch
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ComposerWorkspace() {
  const [pages, setPages] = useState<PageDto[]>([]);
  const [pageId, setPageId] = useState("");
  const [message, setMessage] = useState("");
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [mode, setMode] = useState<PublishMode>("now");
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const [scheduledFor, setScheduledFor] = useState("");
  const [status, setStatus] = useState("Đang tải Pages...");
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [dragActive, setDragActive] = useState(false);
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const [dropTargetMediaId, setDropTargetMediaId] = useState<string | null>(
    null,
  );
  const [scheduleReferenceTime, setScheduleReferenceTime] = useState(() =>
    Date.now(),
  );
  const mediaRef = useRef<LocalMedia[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedPage = pages.find((page) => page.id === pageId);
  const scheduledTimestamp = scheduledFor
    ? new Date(scheduledFor).getTime()
    : Number.NaN;
  const scheduleValid =
    mode === "now" ||
    (Number.isFinite(scheduledTimestamp) &&
      scheduledTimestamp >= scheduleReferenceTime + 20 * 60 * 1000 &&
      scheduledTimestamp <= scheduleReferenceTime + 29 * 24 * 60 * 60 * 1000);
  const canSubmit =
    Boolean(pageId) &&
    (message.trim().length > 0 || media.length > 0) &&
    scheduleValid;

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setScheduleReferenceTime(Date.now()),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      for (const item of mediaRef.current) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void fetch("/api/pages", { headers: { accept: "application/json" } })
      .then((response) => readPayload<{ pages?: PageDto[] }>(response))
      .then((payload) => {
        if (!active) return;
        const nextPages = payload.pages ?? [];
        const firstAllowedPage = nextPages.find((page) => page.canAccess);
        setPages(nextPages);
        setPageId(firstAllowedPage?.id ?? "");
        setStatus(
          nextPages.length === 0
            ? "Chưa có Page trong hệ thống."
            : firstAllowedPage
              ? ""
              : "Bạn chưa được Admin cấp Page nào.",
        );
      })
      .catch((error: unknown) => {
        if (active) {
          setStatus(
            error instanceof Error ? error.message : "Không thể tải Pages.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function appendFiles(files: File[]) {
    const validFiles = files.filter(
      (file) =>
        ACCEPTED_IMAGE_TYPES.has(file.type) && file.size <= MAX_FILE_SIZE,
    );
    if (validFiles.length !== files.length) {
      setStatus("Chỉ nhận JPEG, PNG, WebP và tối đa 10 MB mỗi ảnh.");
    }
    setMedia((current) => {
      const slots = Math.max(0, MAX_IMAGES - current.length);
      const additions = validFiles.slice(0, slots).map((file) => ({
        localId: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      if (validFiles.length > slots) {
        setStatus(`Mỗi bài tối đa ${MAX_IMAGES} ảnh.`);
      }
      return [...current, ...additions];
    });
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    appendFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    appendFiles(Array.from(event.dataTransfer.files));
  }

  function removeMedia(localId: string) {
    setMedia((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
  }

  function moveMedia(index: number, direction: -1 | 1) {
    setMedia((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function reorderMedia(activeId: string, targetId: string) {
    if (activeId === targetId) return;
    setMedia((current) => {
      const activeIndex = current.findIndex(
        (item) => item.localId === activeId,
      );
      const targetIndex = current.findIndex(
        (item) => item.localId === targetId,
      );
      if (activeIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(activeIndex, 1);
      if (!moved) return current;
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function resetMediaDrag() {
    setDraggedMediaId(null);
    setDropTargetMediaId(null);
  }

  async function cleanupAssets(assetIds: string[]) {
    await Promise.allSettled(
      assetIds.map((assetId) =>
        fetch(`/api/assets/${assetId}`, { method: "DELETE" }),
      ),
    );
  }

  async function uploadMedia(uploadedIds: string[]) {
    for (let index = 0; index < media.length; index += 1) {
      setUploadProgress(index + 1);
      const data = new FormData();
      data.set("pageId", pageId);
      data.set("file", media[index]!.file);
      const payload = await readPayload<{ asset: { id: string } }>(
        await fetch("/api/assets", { method: "POST", body: data }),
      );
      uploadedIds.push(payload.asset.id);
    }
  }

  async function submit(action: "draft" | "publish" | "schedule") {
    setSubmitting(true);
    setPendingAction(null);
    setStatus("");
    setUploadProgress(0);
    const assetIds: string[] = [];
    let draftCreated = false;

    try {
      await uploadMedia(assetIds);
      const draftPayload = await readPayload<{ draft: { id: string } }>(
        await fetch("/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pageId, message, assetIds }),
        }),
      );
      draftCreated = true;

      if (action !== "draft") {
        const endpoint = `/api/posts/${draftPayload.draft.id}/${
          action === "publish" ? "publish" : "schedule"
        }`;
        const options: RequestInit = { method: "POST" };
        if (action === "schedule") {
          options.headers = { "content-type": "application/json" };
          options.body = JSON.stringify({
            scheduledFor: new Date(scheduledFor).toISOString(),
          });
        }
        await readPayload(await fetch(endpoint, options));
      }

      for (const item of media) URL.revokeObjectURL(item.previewUrl);
      setMedia([]);
      setMessage("");
      setScheduledFor("");
      setStatus(
        action === "draft"
          ? "Đã lưu bản nháp."
          : action === "publish"
            ? "Facebook đã nhận yêu cầu đăng bài."
            : "Facebook đã xác nhận lịch đăng native.",
      );
    } catch (error) {
      if (!draftCreated && assetIds.length > 0) await cleanupAssets(assetIds);
      setStatus(
        error instanceof Error ? error.message : "Không thể hoàn tất thao tác.",
      );
    } finally {
      setSubmitting(false);
      setUploadProgress(0);
    }
  }

  const previewCount = Math.min(media.length, 4);

  return (
    <div className="composerWorkspace">
      <div className="composerMainGrid">
        <section className="surfaceCard composerEditorCard">
          <header className="composerCardHeader">
            <div>
              <span className="stepLabel">FACEBOOK PAGE</span>
              <ComposerPagePicker
                disabled={submitting || pages.length === 0}
                onChange={setPageId}
                pages={pages}
                value={pageId}
              />
            </div>
            <span className="composerDraftState">Bản nháp tự quản lý</span>
          </header>

          <div className="composerContentPanel">
            <div className="composerContentHeading">
              <div>
                <span className="stepLabel">NỘI DUNG BÀI VIẾT</span>
                <h2>Viết caption</h2>
              </div>
              <button className="composerAiButton" disabled type="button">
                <span>✦</span> AI hỗ trợ · Sắp có
              </button>
            </div>
            <textarea
              aria-label="Nội dung bài viết"
              disabled={!pageId || submitting}
              maxLength={100_000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Bạn muốn chia sẻ điều gì?"
              value={message}
            />
            <div
              className="composerWritingTools"
              aria-label="Công cụ AI dự kiến"
            >
              <span>Ý tưởng</span>
              <span>Viết lại</span>
              <span>CTA & hashtag</span>
              <b>{message.length.toLocaleString("vi-VN")} ký tự</b>
            </div>
          </div>

          <div className="composerMediaPanel">
            <div className="composerMediaHeading">
              <div>
                <span className="stepLabel">HÌNH ẢNH</span>
                <h2>Thư viện bài viết</h2>
                <p>
                  Tối đa 10 ảnh. Kéo trực tiếp từng ảnh để sắp xếp thứ tự gửi
                  sang Facebook.
                </p>
              </div>
              <button
                className="button buttonSecondary composerAddMediaButton"
                disabled={!pageId || submitting || media.length >= MAX_IMAGES}
                onClick={() => inputRef.current?.click()}
                type="button"
              >
                + Thêm ảnh
              </button>
              <input
                accept="image/jpeg,image/png,image/webp"
                hidden
                multiple
                onChange={handleFiles}
                ref={inputRef}
                type="file"
              />
            </div>

            {media.length === 0 ? (
              <div
                className={`composerDropzone ${dragActive ? "isDragActive" : ""}`}
                onClick={() => inputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    inputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="composerDropIcon">＋</span>
                <strong>Kéo ảnh vào đây hoặc chọn từ máy</strong>
                <small>JPEG, PNG, WebP · tối đa 10 MB/ảnh</small>
              </div>
            ) : (
              <div className="composerMediaList">
                {media.map((item, index) => (
                  <article
                    aria-label={`${item.file.name}, ảnh ${index + 1}. Kéo để đổi vị trí hoặc dùng các phím mũi tên.`}
                    className={`composerMediaItem ${draggedMediaId === item.localId ? "isDragging" : ""} ${dropTargetMediaId === item.localId && draggedMediaId !== item.localId ? "isDropTarget" : ""}`}
                    data-media-id={item.localId}
                    draggable={!submitting}
                    key={item.localId}
                    onDragEnd={resetMediaDrag}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node,
                        )
                      ) {
                        setDropTargetMediaId((current) =>
                          current === item.localId ? null : current,
                        );
                      }
                    }}
                    onDragOver={(event) => {
                      if (!draggedMediaId || submitting) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTargetMediaId(item.localId);
                    }}
                    onDragStart={(event) => {
                      if (event.defaultPrevented) return;
                      setDraggedMediaId(item.localId);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.localId);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const activeId =
                        draggedMediaId ||
                        event.dataTransfer.getData("text/plain");
                      if (activeId) reorderMedia(activeId, item.localId);
                      resetMediaDrag();
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (
                        event.key === "ArrowLeft" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        moveMedia(index, -1);
                      } else if (
                        event.key === "ArrowRight" ||
                        event.key === "ArrowDown"
                      ) {
                        event.preventDefault();
                        moveMedia(index, 1);
                      }
                    }}
                    tabIndex={submitting ? -1 : 0}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={`Ảnh ${index + 1}`} src={item.previewUrl} />
                    <span className="composerMediaOrder">{index + 1}</span>
                    <span className="composerMediaTooltip" role="tooltip">
                      <strong>{item.file.name}</strong>
                      <small>{formatFileSize(item.file.size)}</small>
                    </span>
                    <button
                      aria-label={`Xóa ${item.file.name}`}
                      className="composerMediaRemove"
                      disabled={submitting}
                      draggable={false}
                      onClick={() => removeMedia(item.localId)}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      type="button"
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="composerPublishPanel">
            <div
              className={`composerModeSwitch ${mode === "schedule" ? "isSchedule" : ""}`}
            >
              <span aria-hidden="true" className="composerModeIndicator" />
              <button
                className={mode === "now" ? "isActive" : ""}
                onClick={() => setMode("now")}
                type="button"
              >
                Đăng ngay
              </button>
              <button
                className={mode === "schedule" ? "isActive" : ""}
                onClick={() => setMode("schedule")}
                type="button"
              >
                Hẹn giờ
              </button>
            </div>
            <div className="composerScheduleSlot">
              <div
                aria-hidden={mode !== "schedule"}
                className={`composerScheduleField ${mode !== "schedule" ? "isInactive" : ""}`}
              >
                <LiquidDateTimePicker
                  disabled={submitting || mode !== "schedule"}
                  key={mode}
                  max={maximumScheduleValue(scheduleReferenceTime)}
                  min={minimumScheduleValue(scheduleReferenceTime)}
                  onChange={setScheduledFor}
                  value={scheduledFor}
                />
              </div>
            </div>
          </div>

          <footer className="composerActionBar">
            <div>
              {submitting ? (
                <span className="composerSubmitting">
                  <i />
                  {media.length > 0 && uploadProgress > 0
                    ? `Đang tải ảnh ${uploadProgress}/${media.length}`
                    : "Đang xử lý..."}
                </span>
              ) : status ? (
                <span className="composerStatus" role="status">
                  {status}
                </span>
              ) : (
                <span className="composerSafeNote">
                  Không tự động đăng khi chưa xác nhận
                </span>
              )}
            </div>
            <div>
              <button
                className="button buttonSecondary"
                disabled={!canSubmit || submitting}
                onClick={() => void submit("draft")}
                type="button"
              >
                Lưu bản nháp
              </button>
              <button
                className="button"
                disabled={!canSubmit || submitting}
                onClick={() =>
                  setPendingAction(mode === "now" ? "publish" : "schedule")
                }
                type="button"
              >
                {mode === "now" ? "Xem lại & đăng" : "Xem lại & hẹn giờ"}
              </button>
            </div>
          </footer>
        </section>

        <aside className="surfaceCard composerPreviewCard">
          <header>
            <div>
              <span className="stepLabel">XEM TRƯỚC</span>
              <h2>Bài viết Facebook</h2>
            </div>
            <div
              aria-label="Chọn thiết bị xem trước"
              className="composerPreviewDevices"
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
                  aria-label={`Xem trước trên ${label}`}
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
          </header>
          <div
            className={`composerPreviewViewport is-${previewDevice}`}
            data-device={previewDevice}
          >
            <div className="composerPreviewDeviceFrame">
              <div className="facebookPostPreview">
                <div className="facebookPreviewIdentity">
                  {selectedPage ? <PageAvatar page={selectedPage} /> : <span />}
                  <div>
                    <strong>{selectedPage?.name ?? "Facebook Page"}</strong>
                    <small>Công khai · Vừa xong</small>
                  </div>
                </div>
                <p>
                  {message.trim() || "Nội dung bài viết sẽ hiển thị tại đây..."}
                </p>
                {media.length > 0 ? (
                  <div
                    className="facebookMediaLayout"
                    data-count={previewCount}
                  >
                    {media.slice(0, 4).map((item, index) => (
                      <div key={item.localId}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt="" src={item.previewUrl} />
                        {index === 3 && media.length > 4 ? (
                          <b>+{media.length - 4}</b>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="facebookPreviewEmptyMedia">Ảnh xem trước</div>
                )}
                <div className="facebookPreviewFooter">
                  <span>Thích</span>
                  <span>Bình luận</span>
                  <span>Chia sẻ</span>
                </div>
              </div>
            </div>
          </div>
          <div className="composerLayoutNote">
            <strong>Bố cục ảnh tự động</strong>
            <p>
              Facebook quyết định cách ghép cuối cùng; thứ tự ảnh bạn sắp xếp
              vẫn được giữ khi gửi.
            </p>
          </div>
        </aside>
      </div>

      {pendingAction ? (
        <div className="composerConfirmBackdrop" role="presentation">
          <section
            aria-modal="true"
            className="composerConfirmDialog"
            role="dialog"
          >
            <span className="stepLabel">XÁC NHẬN CUỐI</span>
            <h2>
              {pendingAction === "publish"
                ? "Đăng bài ngay?"
                : "Hẹn giờ trên Facebook?"}
            </h2>
            <div className="composerConfirmSummary">
              <div>
                <span>Page</span>
                <strong>{selectedPage?.name}</strong>
              </div>
              <div>
                <span>Nội dung</span>
                <strong>
                  {message.trim()
                    ? `${message.trim().slice(0, 80)}${message.trim().length > 80 ? "…" : ""}`
                    : "Không có caption"}
                </strong>
              </div>
              <div>
                <span>Hình ảnh</span>
                <strong>{media.length} ảnh</strong>
              </div>
              {pendingAction === "schedule" ? (
                <div>
                  <span>Thời gian</span>
                  <strong>
                    {new Date(scheduledFor).toLocaleString("vi-VN")}
                  </strong>
                </div>
              ) : null}
            </div>
            <p>
              {pendingAction === "publish"
                ? "Xác nhận sẽ gửi nội dung lên Facebook ngay lập tức."
                : "Lịch sẽ được tạo trực tiếp trên Facebook, không chạy bằng bộ hẹn giờ của công cụ."}
            </p>
            <footer>
              <button
                className="button buttonSecondary"
                onClick={() => setPendingAction(null)}
                type="button"
              >
                Quay lại
              </button>
              <button
                className="button"
                onClick={() => void submit(pendingAction)}
                type="button"
              >
                {pendingAction === "publish"
                  ? "Xác nhận đăng"
                  : "Xác nhận hẹn giờ"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
