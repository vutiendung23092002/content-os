# NEXT STEPS

Han Content OS đã có luồng MVP nội bộ cho đăng ngay/hẹn giờ native Facebook với ảnh, nhiều ảnh và video thường; Google allowlist, phân quyền Page, Docker runtime, cron đồng bộ và cleanup Storage đều đã hoạt động.

Các bước còn lại được ưu tiên theo rủi ro và giá trị vận hành:

## 1. SEC-003 và SEC-004 — Hardening mutation/credential

- Audit same-origin/CSRF guard trên toàn bộ API thay đổi dữ liệu.
- Rate limit publish, schedule, upload và API quản trị.
- Chuẩn hóa giới hạn caption, timestamp, request body và file.
- Hoàn thiện công cụ/quy trình rotate Facebook token và `TOKEN_ENCRYPTION_KEY` mà không log plaintext.

## 2. Đóng các task Meta/UI đã triển khai

`FB-001` đến `FB-011` đã đóng sau capability smoke `v26.0`, contract/integration tests và live Page-test evidence. Capability report không secret nằm tại `docs/evidence/facebook-capability-v26.md`; không lặp lại destructive smoke trên Page production.

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
