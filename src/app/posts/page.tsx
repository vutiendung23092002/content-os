"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type DraftDto = {
  id: string;
  pageId: string;
  message: string;
  updatedAt: string;
};

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<DraftDto[]>([]);
  const [status, setStatus] = useState("Đang tải drafts...");

  useEffect(() => {
    let active = true;

    void fetch("/api/posts", { headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = (await response.json()) as {
          drafts?: DraftDto[];
          error?: { message?: string };
        };
        if (!response.ok)
          throw new Error(payload.error?.message ?? "Không thể tải drafts.");
        if (active) {
          setDrafts(payload.drafts ?? []);
          setStatus("");
        }
      })
      .catch((error: unknown) => {
        if (active)
          setStatus(
            error instanceof Error ? error.message : "Không thể tải drafts.",
          );
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="appShell">
      <header className="topbar">
        <Link className="brand" href="/">
          HAN CONTENT OS
        </Link>
        <Link className="button" href="/posts/new">
          Tạo draft
        </Link>
      </header>
      <section className="panel">
        <p className="eyebrow">CONTENT</p>
        <h1 className="pageTitle">Drafts</h1>
        {status ? <p className="status">{status}</p> : null}
        {!status && drafts.length === 0 ? (
          <p className="muted">
            Chưa có draft. Page cần được đồng bộ trước khi tạo draft đầu tiên.
          </p>
        ) : null}
        <div className="draftList">
          {drafts.map((draft) => (
            <article className="draftCard" key={draft.id}>
              <p>{draft.message}</p>
              <div className="draftMeta">
                Cập nhật{" "}
                {new Intl.DateTimeFormat("vi-VN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(draft.updatedAt))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
