# NEXT STEPS

Foundation tasks `FOUND-001` đến `FOUND-005` đã hoàn thành. Các bước tiếp theo theo thứ tự an toàn:

Supabase connection/migration `DB-001`, `DB-002`, repository `DB-003` và draft CRUD `POST-001` đã hoàn thành. Meta adapter, sync và submit flow đã có mock tests nhưng chưa gọi Facebook thật.

## 1. FOUND-006 — Hoàn thiện internal access

Google OAuth + allowlist đã được triển khai bằng Supabase Auth. Việc còn lại trước khi test thật là bật Google provider trong Supabase, cấu hình public URL/callback và điền `INITIAL_ADMIN_EMAIL`. Khi triển khai FB-011, bổ sung credential riêng cho cron; Cloudflare Access vẫn là lớp hardening tùy chọn ở edge.

## 2. SEC-002 — Hoàn thiện Page token lifecycle

Nối AES-256-GCM service vào Page credential repository và bổ sung key rotation test ở database layer.

## 3. Chọn Page test

Người vận hành chọn một trong các Page có `CREATE_CONTENT` và `MANAGE`. Không dùng Page chỉ có `ANALYZE`, `ADVERTISE`.

## 4. FB-001 — Capability smoke test

Pin Graph API version trên Page test và xác minh discover Page, publish text, native schedule, list, reschedule, cancel.

## 5. FB-002 — Xác minh Meta adapter

Bổ sung published list, reschedule, cancel, field contracts và capability-specific error mapping.

## 6. FB-003 — Sync managed Pages thật

Upsert Page metadata và encrypted Page token trong một transaction an toàn.

## 7. POST-002 — Hoàn thiện draft editor UI

Xây Page selector, editor, validation và trạng thái lưu.

## 8. FB-004 — Publish text now trên Page test

Nối draft với operation ledger và Meta remote ID; timeout chuyển sang `uncertain`.

## 9. FB-005 — Native scheduled text post trên Page test

Gửi schedule ngay cho Meta, refetch remote scheduled post và không tạo due-time worker.

## 10. FB-006/FB-007 — Published và scheduled lists

Đồng bộ remote-first, có cursor, `lastSyncedAt` và stale/error state rõ ràng.

Acceptance criteria và tests đầy đủ nằm trong root [TODO.md](../TODO.md).
