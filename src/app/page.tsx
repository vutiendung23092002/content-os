import Link from "next/link";

const quickActions = [
  {
    href: "/posts/new",
    number: "01",
    title: "Soạn nội dung mới",
    description: "Tạo draft trước, chỉ đăng khi bạn chủ động xác nhận.",
    action: "Bắt đầu viết",
  },
  {
    href: "/posts",
    number: "02",
    title: "Quản lý bài viết",
    description: "Theo dõi draft, bài đã đăng và lịch đăng trong một nơi.",
    action: "Xem bài viết",
  },
  {
    href: "/pages",
    number: "03",
    title: "Kết nối Facebook Page",
    description: "Kiểm tra tài khoản, quyền Page và thêm Page bằng ID.",
    action: "Quản lý Pages",
  },
];

export default function HomePage() {
  return (
    <div className="pageStack">
      <header className="pageIntro pageIntroWide">
        <div>
          <span className="pageKicker">HAN CONTENT OS</span>
          <h1>Hôm nay bạn muốn làm gì?</h1>
          <p>
            Soạn nội dung, quản lý Page và chuẩn bị lịch đăng Facebook trong một
            quy trình rõ ràng.
          </p>
        </div>
        <Link className="button" href="/posts/new">
          Viết bài mới
        </Link>
      </header>

      <section className="quickActionGrid" aria-label="Thao tác nhanh">
        {quickActions.map((item) => (
          <Link className="quickActionCard" href={item.href} key={item.href}>
            <span>{item.number}</span>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <strong>{item.action} →</strong>
          </Link>
        ))}
      </section>

      <div className="overviewGrid">
        <section className="surfaceCard">
          <div className="sectionHeading">
            <div>
              <span className="pageKicker">QUY TRÌNH</span>
              <h2>Làm việc theo từng bước</h2>
            </div>
          </div>
          <ol className="workflowSteps">
            <li>
              <span>1</span>
              <div>
                <strong>Chọn đúng Facebook Page</strong>
                <p>Kiểm tra tài khoản và quyền trước khi soạn nội dung.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Lưu nội dung thành draft</strong>
                <p>Chỉnh sửa và duyệt nội dung mà chưa tác động Facebook.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Chủ động đăng hoặc hẹn giờ</strong>
                <p>Chỉ gửi lên Meta khi bạn xác nhận thao tác cuối cùng.</p>
              </div>
            </li>
          </ol>
        </section>

        <aside className="surfaceCard safetyCard">
          <span className="safetyIcon" aria-hidden="true">
            ✓
          </span>
          <span className="pageKicker">AN TOÀN FACEBOOK</span>
          <h2>Không có thao tác ngầm</h2>
          <p>
            Kiểm tra Page chỉ dùng request đọc. Token luôn ở phía server và được
            mã hóa trước khi lưu.
          </p>
          <Link href="/pages">Kiểm tra kết nối →</Link>
        </aside>
      </div>
    </div>
  );
}
