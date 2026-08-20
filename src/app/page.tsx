const foundations = [
  "Supabase PostgreSQL + Drizzle",
  "Meta Graph API server-side",
  "Facebook-native scheduling",
  "AI chỉ hỗ trợ soạn nội dung",
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">HAN CONTENT OS</p>
        <h1>Nền tảng đang được khởi tạo</h1>
        <p className="lede">
          Công cụ nội bộ để soạn, đăng và hẹn giờ bài viết cho các Facebook Page
          được quản lý.
        </p>
        <ul>
          {foundations.map((foundation) => (
            <li key={foundation}>{foundation}</li>
          ))}
        </ul>
        <div className="actions">
          <Link className="button" href="/posts">
            Xem drafts
          </Link>
          <Link className="button buttonSecondary" href="/posts/new">
            Tạo draft
          </Link>
        </div>
      </section>
    </main>
  );
}
import Link from "next/link";
