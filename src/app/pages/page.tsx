"use client";

import { type FormEvent, useEffect, useState } from "react";

type ConnectionDto = {
  account: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  token: {
    isValid: boolean;
    type?: string;
    appMatches: boolean;
    userMatches: boolean;
    scopes: string[];
    expiresAt: string | null;
    dataAccessExpiresAt: string | null;
  };
};

type ManualPageDto = {
  account: ConnectionDto["account"];
  token: {
    isValid: boolean;
    scopes: string[];
    expiresAt: string | null;
    dataAccessExpiresAt: string | null;
  };
  page: {
    localId?: string;
    externalPageId: string;
    name: string;
    avatarUrl?: string;
    category?: string;
  };
  capabilities: {
    readPublishedPosts: boolean;
    readScheduledPosts: boolean;
    managePostsScope: boolean;
    manageEngagementScope: boolean;
    readInsightsScope: boolean;
    manageMetadataScope: boolean;
  };
};

type StoredPageDto = {
  id: string;
  externalPageId: string;
  name: string;
  avatarUrl: string | null;
  category: string | null;
  connectionStatus: string;
  canAccess: boolean;
  accessReason: string | null;
};

type ViewerRole = "super_admin" | "admin" | "member";

const capabilityLabels: Array<
  [keyof ManualPageDto["capabilities"], string, string]
> = [
  ["readPublishedPosts", "Đọc bài đã đăng", "Đã kiểm tra bằng GET"],
  ["readScheduledPosts", "Đọc bài hẹn giờ", "Đã kiểm tra bằng GET"],
  ["managePostsScope", "Quản lý bài viết", "Scope pages_manage_posts"],
  ["manageEngagementScope", "Quản lý tương tác", "Scope được cấp"],
  ["readInsightsScope", "Đọc Insights", "Scope được cấp"],
  ["manageMetadataScope", "Quản lý metadata", "Scope được cấp"],
];

async function readPayload<ResponseBody>(response: Response) {
  const payload = (await response.json()) as ResponseBody & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Yêu cầu không thành công.");
  }
  return payload;
}

function formatDate(value: string | null): string {
  if (!value) return "Không có hạn token riêng";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Avatar({ name, url }: { name: string; url?: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" className="entityAvatar" src={url} />
  ) : (
    <span className="entityAvatar avatarFallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function PagesPage() {
  const [connection, setConnection] = useState<ConnectionDto | null>(null);
  const [storedPages, setStoredPages] = useState<StoredPageDto[]>([]);
  const [pageId, setPageId] = useState("");
  const [preview, setPreview] = useState<ManualPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingPageId, setRemovingPageId] = useState("");
  const [removalTarget, setRemovalTarget] = useState<StoredPageDto | null>(
    null,
  );
  const [viewerRole, setViewerRole] = useState<ViewerRole>("member");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function loadStoredPages() {
    const response = await fetch("/api/pages", {
      headers: { accept: "application/json" },
    });
    const payload = await readPayload<{ pages?: StoredPageDto[] }>(response);
    setStoredPages(payload.pages ?? []);
  }

  useEffect(() => {
    let active = true;

    void Promise.all([
      fetch("/api/facebook/status", {
        headers: { accept: "application/json" },
      }).then((response) =>
        readPayload<{ connection?: ConnectionDto | null }>(response),
      ),
      fetch("/api/pages", {
        headers: { accept: "application/json" },
      }).then((response) => readPayload<{ pages?: StoredPageDto[] }>(response)),
      fetch("/api/auth/session", {
        headers: { accept: "application/json" },
      }).then((response) =>
        readPayload<{ viewer?: { role: ViewerRole } }>(response),
      ),
    ])
      .then(([statusPayload, pagesPayload, sessionPayload]) => {
        if (!active) return;
        setConnection(statusPayload.connection ?? null);
        setStoredPages(pagesPayload.pages ?? []);
        setViewerRole(sessionPayload.viewer?.role ?? "member");
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Không thể tải trạng thái Facebook.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function checkPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecking(true);
    setPreview(null);
    setStatus("");
    setError("");

    try {
      const response = await fetch("/api/facebook/pages/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId: pageId.trim() }),
      });
      const payload = await readPayload<{ page: ManualPageDto }>(response);
      setPreview(payload.page);
      setStatus("Kiểm tra hoàn tất. Facebook chưa bị thay đổi dữ liệu.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Không thể kiểm tra Page.",
      );
    } finally {
      setChecking(false);
    }
  }

  async function addPage() {
    if (!preview || preview.page.externalPageId !== pageId.trim()) return;
    setAdding(true);
    setStatus("");
    setError("");

    try {
      const response = await fetch("/api/facebook/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId: pageId.trim() }),
      });
      const payload = await readPayload<{ page: ManualPageDto }>(response);
      setPreview(payload.page);
      await loadStoredPages();
      setStatus(
        "Đã thêm Page vào hệ thống. Admin cần phân quyền Page cho từng tài khoản trước khi sử dụng.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Không thể thêm Page.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function removePage() {
    if (!removalTarget) return;
    setRemovingPageId(removalTarget.id);
    setStatus("");
    setError("");

    try {
      const response = await fetch(
        `/api/pages/${encodeURIComponent(removalTarget.id)}`,
        { method: "DELETE", headers: { accept: "application/json" } },
      );
      await readPayload<{ removedPage: { id: string } }>(response);
      await loadStoredPages();
      if (preview?.page.localId === removalTarget.id) setPreview(null);
      setStatus(
        `Đã gỡ ${removalTarget.name} khỏi hệ thống. Facebook Page không bị thay đổi.`,
      );
      setRemovalTarget(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Không thể gỡ Page khỏi hệ thống.",
      );
    } finally {
      setRemovingPageId("");
    }
  }

  const canRemovePages = viewerRole === "admin" || viewerRole === "super_admin";

  return (
    <div className="pageStack">
      <div className="pageManagementGrid">
        <div className="pageManagementMain">
          <section className="surfaceCard addPageCard">
            <div className="sectionHeading">
              <div>
                <span className="stepLabel">THÊM PAGE MỚI</span>
                <h2>Dán Page ID để bắt đầu</h2>
                <p>
                  Hệ thống sẽ kiểm tra tên Page, Page token và các quyền đọc
                  trước khi cho phép lưu.
                </p>
              </div>
              <span className="cardIndex">01</span>
            </div>

            <div className="processSteps" aria-label="Quy trình thêm Page">
              <div className="isCurrent">
                <span>1</span>
                <strong>Nhập Page ID</strong>
              </div>
              <div className={preview ? "isComplete" : ""}>
                <span>2</span>
                <strong>Kiểm tra quyền</strong>
              </div>
              <div className={preview?.page.localId ? "isComplete" : ""}>
                <span>3</span>
                <strong>Thêm vào hệ thống</strong>
              </div>
            </div>

            <form className="pageIdForm" onSubmit={checkPage}>
              <label htmlFor="page-id">Facebook Page ID</label>
              <div className="pageIdInputRow">
                <input
                  aria-describedby="page-id-hint"
                  autoComplete="off"
                  disabled={checking || adding}
                  id="page-id"
                  inputMode="numeric"
                  maxLength={30}
                  onChange={(event) => {
                    setPageId(event.target.value.replace(/\D/g, ""));
                    setPreview(null);
                    setStatus("");
                    setError("");
                  }}
                  pattern="[0-9]{5,30}"
                  placeholder="Ví dụ: 123456789012345"
                  required
                  value={pageId}
                />
                <button
                  className="button"
                  disabled={checking || adding || pageId.length < 5}
                  type="submit"
                >
                  {checking ? "Đang kiểm tra..." : "Kiểm tra quyền"}
                </button>
              </div>
              <small id="page-id-hint">
                Bạn có thể lấy ID từ URL Page hoặc workflow cũ.
              </small>
            </form>

            {error ? (
              <div className="feedback feedbackError">{error}</div>
            ) : null}
            {status ? (
              <div className="feedback feedbackSuccess">{status}</div>
            ) : null}

            {preview ? (
              <article className="verificationResult">
                <div className="verifiedPageHeader">
                  <Avatar
                    name={preview.page.name}
                    url={preview.page.avatarUrl}
                  />
                  <div>
                    <span className="verifiedLabel">PAGE ĐÃ XÁC MINH</span>
                    <h3>{preview.page.name}</h3>
                    <p>
                      ID {preview.page.externalPageId}
                      {preview.page.category
                        ? ` · ${preview.page.category}`
                        : ""}
                    </p>
                  </div>
                  <span className="badge badgeSuccess">Token hợp lệ</span>
                </div>

                <div className="capabilityGrid">
                  {capabilityLabels.map(([key, label, note]) => (
                    <div
                      className={
                        preview.capabilities[key]
                          ? "capabilityItem isGranted"
                          : "capabilityItem"
                      }
                      key={key}
                    >
                      <span aria-hidden="true">
                        {preview.capabilities[key] ? "✓" : "—"}
                      </span>
                      <div>
                        <strong>{label}</strong>
                        <small>{note}</small>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="verificationFooter">
                  <p>
                    Không có bài viết nào được tạo, sửa hoặc xóa trong quá trình
                    kiểm tra.
                  </p>
                  <button
                    className="button"
                    disabled={adding || Boolean(preview.page.localId)}
                    onClick={() => void addPage()}
                    type="button"
                  >
                    {adding
                      ? "Đang thêm..."
                      : preview.page.localId
                        ? "Đã thêm Page"
                        : "Thêm Page này"}
                  </button>
                </div>
              </article>
            ) : null}
          </section>

          <section className="surfaceCard storedPagesCard">
            <div className="sectionHeading">
              <div>
                <span className="stepLabel">ĐANG QUẢN LÝ</span>
                <h2>Facebook Pages</h2>
                <p>{storedPages.length} Page đang được lưu trong hệ thống.</p>
              </div>
            </div>
            {storedPages.length === 0 ? (
              <div className="emptyState">
                <strong>Chưa có Page nào</strong>
                <p>Dán Page ID ở phía trên để thêm Page đầu tiên.</p>
              </div>
            ) : (
              <div className="managedPageTable">
                <div
                  className={`managedPageTableHead ${
                    canRemovePages ? "canManage" : ""
                  }`}
                >
                  <span>Page</span>
                  <span>Quyền sử dụng</span>
                  {canRemovePages ? <span>Thao tác</span> : null}
                </div>
                {storedPages.map((page) => (
                  <article
                    className={`managedPageTableRow ${
                      canRemovePages ? "canManage" : ""
                    }`}
                    key={page.id}
                  >
                    <div className="managedPageIdentity">
                      <Avatar name={page.name} url={page.avatarUrl} />
                      <div>
                        <strong>{page.name}</strong>
                        <small>
                          {page.externalPageId}
                          {page.category ? ` · ${page.category}` : ""}
                        </small>
                      </div>
                    </div>
                    <span
                      className={`badge ${
                        page.canAccess ? "badgeSuccess" : "badgeNeutral"
                      }`}
                      title={page.accessReason ?? undefined}
                    >
                      <span className="statusDot" />
                      {page.canAccess ? "Đã được cấp" : "Chờ phân quyền"}
                    </span>
                    {canRemovePages ? (
                      <button
                        className="removeManagedPageButton"
                        disabled={Boolean(removingPageId)}
                        onClick={() => setRemovalTarget(page)}
                        type="button"
                      >
                        Gỡ Page
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="connectionRail">
          <section className="surfaceCard connectedAccountCard">
            <span className="stepLabel">TÀI KHOẢN KIỂM TRA QUYỀN</span>
            {loading ? <p className="status">Đang kiểm tra token...</p> : null}
            {!loading && connection ? (
              <>
                <div className="connectedAccountIdentity">
                  <Avatar
                    name={connection.account.name}
                    url={connection.account.avatarUrl}
                  />
                  <div>
                    <strong>{connection.account.name}</strong>
                    <small>ID {connection.account.id}</small>
                  </div>
                </div>
                <div className="connectionStatusLine">
                  <span className="statusDot" />
                  <div>
                    <strong>Token đang hoạt động</strong>
                    <small>
                      Dữ liệu đến{" "}
                      {formatDate(connection.token.dataAccessExpiresAt)}
                    </small>
                  </div>
                </div>
                <dl className="connectionDetails">
                  <div>
                    <dt>Đúng Facebook App</dt>
                    <dd>{connection.token.appMatches ? "Có" : "Không"}</dd>
                  </div>
                  <div>
                    <dt>Khớp tài khoản</dt>
                    <dd>{connection.token.userMatches ? "Có" : "Không"}</dd>
                  </div>
                </dl>
                <p className="railHint">
                  Hãy dùng đúng tài khoản này khi xin thêm quyền trên Page.
                </p>
              </>
            ) : null}
            {!loading && !connection ? (
              <p className="statusError">Chưa xác định được tài khoản token.</p>
            ) : null}
          </section>

          <section className="surfaceCard readOnlyCard">
            <span className="readOnlyIcon" aria-hidden="true">
              ✓
            </span>
            <h3>Kiểm tra an toàn</h3>
            <p>
              Chức năng này chỉ đọc metadata, bài đã đăng và bài hẹn giờ để xác
              minh quyền.
            </p>
            <ul>
              <li>Không đăng bài test</li>
              <li>Không sửa bài hiện có</li>
              <li>Không xóa dữ liệu Facebook</li>
            </ul>
          </section>
        </aside>
      </div>

      {removalTarget ? (
        <div
          className="pageRemovalBackdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !removingPageId) {
              setRemovalTarget(null);
            }
          }}
        >
          <section
            aria-labelledby="remove-page-title"
            aria-modal="true"
            className="pageRemovalDialog"
            role="dialog"
          >
            <span className="stepLabel">GỠ KHỎI HỆ THỐNG</span>
            <h2 id="remove-page-title">Gỡ {removalTarget.name}?</h2>
            <p>
              Page sẽ biến mất khỏi HanContent với tất cả tài khoản và mọi phân
              quyền nhân sự sẽ bị thu hồi. Bài viết và Page trên Facebook không
              bị xóa hoặc thay đổi.
            </p>
            <div className="pageRemovalActions">
              <button
                className="button buttonSecondary"
                disabled={Boolean(removingPageId)}
                onClick={() => setRemovalTarget(null)}
                type="button"
              >
                Giữ lại
              </button>
              <button
                className="button removePageConfirmButton"
                disabled={Boolean(removingPageId)}
                onClick={() => void removePage()}
                type="button"
              >
                {removingPageId ? "Đang gỡ..." : "Gỡ khỏi hệ thống"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
