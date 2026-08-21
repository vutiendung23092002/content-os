"use client";

import { type FormEvent, useEffect, useState } from "react";

type PageDto = {
  id: string;
  name: string;
  category: string | null;
};

export default function NewDraftPage() {
  const [pages, setPages] = useState<PageDto[]>([]);
  const [pageId, setPageId] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("Đang tải Pages...");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    void fetch("/api/pages", { headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = (await response.json()) as {
          pages?: PageDto[];
          error?: { message?: string };
        };
        if (!response.ok)
          throw new Error(payload.error?.message ?? "Không thể tải Pages.");
        if (active) {
          const nextPages = payload.pages ?? [];
          setPages(nextPages);
          setPageId(nextPages[0]?.id ?? "");
          setStatus(nextPages.length === 0 ? "Chưa có Page đã đồng bộ." : "");
        }
      })
      .catch((error: unknown) => {
        if (active)
          setStatus(
            error instanceof Error ? error.message : "Không thể tải Pages.",
          );
      });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");

    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId, message }),
      });
      const payload = (await response.json()) as {
        draft?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Không thể lưu draft.");

      setMessage("");
      setStatus("Đã lưu draft.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Không thể lưu draft.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pageStack">
      <header className="pageIntro">
        <div>
          <span className="pageKicker">CONTENT COMPOSER</span>
          <h1>Soạn bài mới</h1>
          <p>
            Lưu thành draft trước. Chưa có nội dung nào được gửi lên Facebook.
          </p>
        </div>
      </header>
      <div className="composerGrid">
        <section className="surfaceCard">
          <div className="sectionHeading">
            <div>
              <span className="stepLabel">BƯỚC 1</span>
              <h2>Chọn Page và viết nội dung</h2>
            </div>
          </div>
          <form className="stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="page">Facebook Page</label>
              <select
                disabled={pages.length === 0 || submitting}
                id="page"
                onChange={(event) => setPageId(event.target.value)}
                required
                value={pageId}
              >
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                    {page.category ? ` — ${page.category}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="message">Nội dung</label>
              <textarea
                disabled={pages.length === 0 || submitting}
                id="message"
                maxLength={100_000}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Viết caption..."
                required
                value={message}
              />
            </div>
            <button
              className="button"
              disabled={
                pages.length === 0 || submitting || message.trim().length === 0
              }
              type="submit"
            >
              {submitting ? "Đang lưu..." : "Lưu draft"}
            </button>
            {status ? <p className="status">{status}</p> : null}
          </form>
        </section>
        <aside className="surfaceCard composerAside">
          <span className="stepLabel">TRẠNG THÁI</span>
          <h2>Chỉ lưu nội bộ</h2>
          <p>
            Nút “Lưu draft” chỉ ghi nội dung vào Supabase. Không gọi API đăng
            bài hoặc hẹn giờ của Meta.
          </p>
          <div className="composerChecklist">
            <span>✓ Chọn Page quản lý</span>
            <span>✓ Soạn caption</span>
            <span>— Duyệt và đăng sau</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
