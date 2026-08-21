# Product overview

## Mục đích

Han Content OS là tool nội bộ cho một nhóm nhỏ, dùng token Facebook cố định của chủ hệ thống để quản lý các Page mà token có quyền. Tool tập trung vào đăng bài, dùng chức năng hẹn giờ native của Facebook, xem bài đã đăng/bài đang hẹn giờ và dùng AI hỗ trợ viết content.

Đây không phải SaaS. Không có public signup, billing, customer tenant hoặc luồng mỗi khách hàng tự kết nối Facebook. Chỉ email Google được Admin duyệt mới dùng được tool.

## Người sử dụng

MVP phục vụ Super Admin, một số Admin tùy chọn và vài nhân viên. Supabase Google OAuth xác thực danh tính; allowlist trong database quyết định quyền truy cập. “Không có Facebook Login cho nhân sự” không có nghĩa URL được phép public không bảo vệ.

## Core features

1. Cấu hình User Access Token của operator ở server.
2. Đồng bộ danh sách Page và Page Access Token từ Meta Graph API.
3. Chọn Page đang thao tác.
4. Soạn và lưu draft text; thêm single image sau khi text flow ổn định.
5. Publish ngay qua Graph API.
6. Tạo Facebook-native scheduled post với `published=false` và `scheduled_publish_time`.
7. Đọc `/{page-id}/scheduled_posts` để hiển thị lịch thật trên Facebook.
8. Đồng bộ danh sách bài đã đăng từ Facebook.
9. Sửa/reschedule/xóa scheduled post trong phạm vi API version hỗ trợ.
10. AI generate/rewrite/ideas; operator phải xem và bấm publish/schedule.

## Luồng chính

```text
Server token
  -> Sync managed Pages
  -> Select Page
  -> Draft / AI assist
  -> Publish now OR Schedule on Facebook
  -> Save remote post ID
  -> Reconcile scheduled/published lists from Meta
```

## Source of truth

- Meta là authority cho remote Page post, trạng thái scheduled và trạng thái published.
- PostgreSQL giữ draft, local mapping/cache, AI history, sync state và error metadata đã làm sạch.
- Sau khi Meta đã nhận schedule, không dùng local worker để đăng lại vào đúng giờ.

## MVP content types

- Text post.
- Single image post sau khi capability test thành công.
- Multi-image chỉ thêm sau test Page cụ thể.
- Video/Reel, Stories và Instagram chưa nằm trong MVP.

## Explicit non-goals

- Users, Teams, invites, roles và Page-level permissions.
- Review, approval, assignment, comments, notifications.
- Brand/Product/Campaign/RAG phức tạp.
- Tool tự publish AI output không có người kiểm tra.
- Scraping, Selenium, cookie automation hoặc private Facebook endpoints.
- Worker giữ lịch rồi tự gọi publish đúng giờ khi Facebook native scheduling dùng được.

## Nguyên tắc tuân thủ Meta

- Chỉ dùng Graph API public/documented với Meta App và token hợp lệ của operator.
- Chỉ thao tác Page được trả về bởi quyền của token.
- Request scope tối thiểu; dự kiến `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, nhưng phải xác minh theo Graph API version/App Dashboard.
- Token server-only, không Git/frontend/log/Sentry/AI prompt.
- Không scrape dữ liệu Facebook và không bypass rate/permission limits.
- Nội dung cuối cùng vẫn phải tuân thủ Community Standards, Page và Commercial Terms.

## Thành công của MVP

```text
Token hợp lệ
-> thấy các Page quản lý
-> tạo draft
-> publish ngay
-> schedule native trên Facebook
-> thấy scheduled post từ Meta
-> reschedule/cancel
-> sau giờ đăng thấy post trong Published
```

Không tạo duplicate, không để token lộ và không hiển thị local status trái với remote status.

## Open questions

- Graph API version chính thức sẽ pin sau capability smoke test.
- Chọn S3 hay R2 khi bắt đầu single-image extension.
- AI provider/model và giới hạn ngân sách.
