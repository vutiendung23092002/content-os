# Han Content OS

Han Content OS là công cụ nội bộ để soạn, quản lý và đăng nội dung lên các Facebook Page bằng Meta Graph API. Ứng dụng dùng Google OAuth để đăng nhập, phân quyền nhân sự theo từng Page và giữ toàn bộ Facebook token/secret ở phía server.

## Chức năng chính

- Quản lý Facebook Page bằng Page ID và kiểm tra quyền trước khi thêm.
- Duyệt tài khoản Google, gán vai trò và giới hạn Page cho từng nhân sự.
- Soạn caption, lưu bản nháp và có vùng mở rộng cho AI hỗ trợ nội dung.
- Đăng ngay hoặc hẹn giờ bằng cơ chế hẹn giờ native của Facebook.
- Hỗ trợ bài chữ, nhiều ảnh có sắp xếp thứ tự và video thường của Page.
- Xem bài đã đăng hoặc đã hẹn giờ theo bảng và timeline tuần.
- Đồng bộ trạng thái từ Facebook, đối soát lịch đăng và tránh gửi lại mù khi kết quả chưa rõ.
- Dùng Supabase Cloud cho PostgreSQL, Google Auth và Storage tạm thời cho media.

## Nguyên tắc vận hành

- Facebook là nguồn dữ liệu chuẩn cho trạng thái bài đăng và lịch hẹn.
- Bài hẹn giờ được Facebook tự đăng; hệ thống không chạy worker để đăng khi đến giờ.
- Token, App Secret, service-role key và cron secret chỉ tồn tại ở server.
- Gỡ Page khỏi ứng dụng chỉ vô hiệu hóa Page trong Han Content OS, không xóa hay sửa dữ liệu trên Facebook.
- Mọi thao tác ghi lên Facebook đều cần người dùng xác nhận rõ ràng.

## Kiến trúc tổng quát

```text
Trình duyệt
    |
    v
Next.js (UI + API server-side)
    |---------------------> Meta Graph API
    |
    +---------------------> Supabase Cloud
    |                         - PostgreSQL
    |                         - Google Auth
    |                         - Storage
    |
    +<--------------------- Cron đối soát / dọn media

Cloudflare Tunnel -> Next.js trên máy chủ nội bộ
```

## Bắt đầu sử dụng

- Chạy trực tiếp bằng Node.js: [Hướng dẫn setup local](docs/16-LOCAL-SETUP.md)
- Chạy bằng Docker Compose: [Hướng dẫn setup Docker](docs/17-DOCKER-SETUP.md)
- Xem trạng thái triển khai hiện tại: [CURRENT-STATE.md](docs/CURRENT-STATE.md)
- Xem công việc còn lại: [TODO.md](TODO.md) và [NEXT-STEPS.md](docs/NEXT-STEPS.md)

## Tài liệu chi tiết

| Tài liệu                                                                | Nội dung                               |
| ----------------------------------------------------------------------- | -------------------------------------- |
| [00-PRODUCT-OVERVIEW.md](docs/00-PRODUCT-OVERVIEW.md)                   | Phạm vi sản phẩm và nguyên tắc cốt lõi |
| [01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md)                           | Kiến trúc tổng thể                     |
| [02-TECH-STACK.md](docs/02-TECH-STACK.md)                               | Công nghệ và thư viện                  |
| [03-DATABASE-DESIGN.md](docs/03-DATABASE-DESIGN.md)                     | Thiết kế database                      |
| [04-AUTH-AND-PERMISSIONS.md](docs/04-AUTH-AND-PERMISSIONS.md)           | Đăng nhập và phân quyền                |
| [05-FACEBOOK-META-INTEGRATION.md](docs/05-FACEBOOK-META-INTEGRATION.md) | Tích hợp Meta Graph API                |
| [06-CONTENT-WORKFLOW.md](docs/06-CONTENT-WORKFLOW.md)                   | Luồng draft, đăng ngay và hẹn giờ      |
| [07-BACKGROUND-JOBS.md](docs/07-BACKGROUND-JOBS.md)                     | Cron, đối soát và dọn media            |
| [08-AI-RAG.md](docs/08-AI-RAG.md)                                       | Định hướng AI hỗ trợ nội dung          |
| [09-AI-IMAGE.md](docs/09-AI-IMAGE.md)                                   | Định hướng AI hình ảnh                 |
| [10-ANALYTICS.md](docs/10-ANALYTICS.md)                                 | Định hướng analytics                   |
| [11-SECURITY.md](docs/11-SECURITY.md)                                   | Bảo mật và quản lý secret              |
| [12-API-DESIGN.md](docs/12-API-DESIGN.md)                               | Thiết kế API                           |
| [13-OBSERVABILITY.md](docs/13-OBSERVABILITY.md)                         | Log, theo dõi và xử lý sự cố           |
| [14-ROADMAP.md](docs/14-ROADMAP.md)                                     | Roadmap sản phẩm                       |
| [15-ADRS.md](docs/15-ADRS.md)                                           | Các quyết định kiến trúc               |
| [16-LOCAL-SETUP.md](docs/16-LOCAL-SETUP.md)                             | Cài đặt và vận hành local              |
| [17-DOCKER-SETUP.md](docs/17-DOCKER-SETUP.md)                           | Build và vận hành Docker Compose       |

## Bảo mật

Không commit hoặc gửi qua issue, log, ảnh chụp hay công cụ AI các file `.env*`, database URL, Facebook token, App Secret, Supabase service-role key, cron secret hoặc Cloudflare Tunnel token. Khi nghi ngờ bị lộ, hãy rotate secret tương ứng.

## Phạm vi sử dụng

Dự án hiện phục vụ nội bộ HanContent; chưa được thiết kế như một nền tảng SaaS công khai.
