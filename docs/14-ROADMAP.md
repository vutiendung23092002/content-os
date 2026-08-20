# ROADMAP

## Nguyên tắc ưu tiên

Hoàn thiện một đường dọc nhỏ nhưng đáng tin cậy trước: kết nối token server-side → chọn Page → soạn text → đăng ngay/lên lịch native → xem trạng thái remote. Không mở rộng sang nhiều người dùng, workflow duyệt hoặc analytics trước khi đường dọc này ổn định.

## Phase 0 — Xác minh Meta capability

- Chọn Meta App và Page test.
- Pin Graph API version.
- Xác minh user token lấy được Page/Page token.
- Smoke test text publish, native schedule, list scheduled, list published, reschedule và cancel.
- Ghi lại quyền, access level, giới hạn thời gian và lỗi thực tế.

Điều kiện qua phase: toàn bộ capability cốt lõi chạy trên Page test bằng API chính thức.

## Phase 1 — Nền tảng nội bộ

- Khởi tạo Next.js/TypeScript.
- PostgreSQL + Drizzle + migration.
- Access gateway/admin protection.
- Secret management, encryption và structured logging.
- Health check, test setup và CI cơ bản.

## Phase 2 — Facebook connection

- Đọc user access token từ server secret.
- Sync danh sách Page và Page token.
- Mã hóa Page token trong database.
- Page selector, connection status và lỗi permission rõ ràng.
- Meta adapter pin version, timeout và error mapping.

## Phase 3 — Posting lõi

- Tạo/sửa draft text.
- Publish now.
- Native scheduled post.
- Danh sách remote published/scheduled.
- Reschedule/cancel.
- Operation ledger và reconciliation cho timeout.
- Cron chỉ sync, không tự publish.

Đây là mốc MVP đầu tiên có thể sử dụng hằng ngày.

## Phase 4 — AI content assistant

- Generate caption từ brief.
- Rewrite theo giọng điệu/độ dài.
- Gợi ý ý tưởng, CTA, hashtag.
- Human-in-the-loop trước khi draft thay đổi.
- Usage/cost limit và prompt redaction.

## Phase 5 — Một ảnh mỗi bài

- Private object storage và signed upload.
- Validate/preview ảnh.
- Publish/schedule single-image post.
- Cleanup an toàn và reconciliation.

## Sau MVP, chỉ khi có nhu cầu

- Analytics/insights đã xác minh permission và metric.
- AI image generation.
- Video, carousel hoặc Reels.
- OAuth cho người dùng khác tự kết nối Page.
- Multi-user, role, approval workflow.
- Trigger.dev hoặc queue nếu sync/reconciliation vượt khả năng cron đơn giản.

Mỗi hạng mục sau MVP phải có use case thực tế, capability test và đánh giá chính sách trước khi đưa vào backlog phát triển.
