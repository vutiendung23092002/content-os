# NEXT STEPS

Han Content OS đã có luồng MVP nội bộ cho đăng ngay/hẹn giờ native Facebook với ảnh, nhiều ảnh và video thường; Google allowlist, phân quyền Page, Docker runtime, cron đồng bộ và cleanup Storage đều đã hoạt động.

Các bước còn lại được ưu tiên theo rủi ro và giá trị vận hành:

## 1. SEC-003 và SEC-004 — Hardening mutation/credential

- Audit same-origin/CSRF guard trên toàn bộ API thay đổi dữ liệu.
- Rate limit publish, schedule, upload và API quản trị.
- Chuẩn hóa giới hạn caption, timestamp, request body và file.
- Hoàn thiện công cụ/quy trình rotate Facebook token và `TOKEN_ENCRYPTION_KEY` mà không log plaintext.

## 2. Đóng các task Meta/UI đã triển khai

Audit acceptance criteria và E2E còn thiếu trước khi đóng `FB-001` đến `FB-007`. `FB-008`, `FB-009` và `POST-003` đến `POST-005` đã hoàn tất live smoke trên Page test. Không đánh dấu các task còn lại hoàn thành chỉ dựa trên việc giao diện đã hiển thị; cần lưu evidence từ Page test và xác minh mirror/cursor/trạng thái lỗi.

## 3. OBS-001, OBS-002 và DEPLOY — Production readiness

- Metrics/alert cho credential lỗi, cron lỗi, sync stale và operation `uncertain`.
- Runbook cho token hết hạn, lịch biến mất, Meta timeout và cron ngừng chạy.
- Test container tự khởi động sau reboot, health check, database backup/restore và secret scan.
- Chạy full quality gate trên bản build sẽ phát hành.

## 4. Tính năng sau MVP

- AI hỗ trợ caption/rewrite/CTA/hashtag theo cơ chế human-in-the-loop, không tự đăng.
- Dashboard thống kê khi đã chốt đúng chỉ số cần theo dõi.
- Reel publishing chỉ triển khai qua flow `video_reels` riêng khi có nhu cầu xác nhận.

Acceptance criteria và test chi tiết nằm trong root [TODO.md](../TODO.md). Trạng thái đã xác minh nằm trong [CURRENT-STATE.md](CURRENT-STATE.md).
