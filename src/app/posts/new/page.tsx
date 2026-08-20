"use client";

import Link from "next/link";
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
    <main className="appShell">
      <header className="topbar">
        <Link className="brand" href="/">
          HAN CONTENT OS
        </Link>
        <Link className="button buttonSecondary" href="/posts">
          Quay lại drafts
        </Link>
      </header>
      <section className="panel">
        <p className="eyebrow">NEW CONTENT</p>
        <h1 className="pageTitle">Tạo draft</h1>
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
    </main>
  );
}
