# CURRENT STATE

**Kiểm tra tại:** 2026-08-20  
**Workspace:** `C:\Users\Dung\Documents\Project\han-content-os`

## Kết luận

Implementation foundation đã bắt đầu. Repository hiện có ứng dụng Next.js chạy/build được, Supabase PostgreSQL schema đã migrate, security primitives và Meta Graph adapter. Meta token thật mới chỉ được dùng cho lần đọc `/me/accounts`; chưa tạo, sửa hoặc xóa bài Facebook.

## Toolchain đã pin

- Node.js `>=24`.
- pnpm `11.22.0` qua Corepack.
- Next.js `16.3.1`, React `19.2.8`, strict TypeScript `5.9.3`.
- PostgreSQL + Drizzle ORM/Drizzle Kit.
- Zod, Pino, Vitest, ESLint và Prettier.

Windows hiện không cho Corepack tạo global pnpm shim trong `Program Files`; trên máy này dùng `corepack pnpm <command>`. CI cài pnpm shim bình thường.

## Đã implement

### Foundation

- Git repository trên branch `main`.
- Next.js App Router với trang foundation và health route.
- Strict TypeScript, format, lint, typecheck, test, build scripts.
- GitHub Actions CI không cần production secret.
- Typed server environment và `.env.example` placeholder.
- Safe API error contract, request ID và structured logger redaction.
- Internal access guard: local dev được phép khi chưa có secret; production fail closed.

### Database

- Cả pooled `DATABASE_URL` và migration `DIRECT_DATABASE_URL` đã kết nối thành công.
- Drizzle schema `hancontent_os` cho 9 bảng MVP.
- Enum, foreign key, unique/index và check constraint cốt lõi.
- Supabase-compatible runtime client dùng pooled URL với prepared statement tắt.
- Drizzle config dùng direct URL cho migration.
- Migration đầu tiên: `drizzle/0000_empty_human_cannonball.sql`.
- Migration đã áp dụng thành công lên Supabase.
- Catalog verification xác nhận 9 bảng, 10 foreign key và 5 check constraint trong `hancontent_os`.

Drizzle dùng schema nội bộ `drizzle` riêng cho bảng lịch sử migration; toàn bộ application table/enum nằm trong `hancontent_os`, không nằm trong `public`.

### Credential security

- AES-256-GCM cho Page token.
- Nonce ngẫu nhiên, authentication tag, key version và SHA-256 fingerprint.
- Test round-trip, tamper detection và invalid configuration.
- Không có token/secret thật trong repository.

### Meta adapter

- User/Page token chỉ đi qua `Authorization: Bearer`, không nằm trong URL.
- `GET /me/accounts` để đọc Page và Page token.
- Publish text qua Page feed.
- Native text schedule bằng `published=false` và `scheduled_publish_time`.
- Đọc scheduled posts và cursor an toàn.
- Đọc published posts, reschedule và cancel contracts.
- Timeout và normalized error không trả raw provider message.
- `/api/facebook/status` chỉ trả boolean cấu hình, không trả secret.

### Repository và local application

- Repository cho Page, encrypted Page credential, draft và Facebook operation.
- Transaction boundary đã chạy integration test thật trên Supabase và rollback sạch dữ liệu test.
- Page sync service phân trang, mã hóa Page token trước persistence và chỉ trả safe DTO.
- Draft create/list/get/update/delete service và API.
- Publish-now/native-schedule orchestration có operation ledger, double-submit claim và mock Meta client.
- Timeout/retryable create được đánh dấu `uncertain`; không blind retry.
- Meta thành công nhưng local commit lỗi được giữ cho reconciliation, không đổi thành remote failure.
- Local UI `/posts` và `/posts/new`.

Meta contracts vẫn có mock tests. Read-only discovery trên Graph API `v26.0` đã thành công: 6 Page được đồng bộ, Page token mã hóa trong Supabase và response không chứa credential. Năm Page có `CREATE_CONTENT`/`MANAGE`; một Page chỉ có `ANALYZE`/`ADVERTISE` nên không được dùng để test đăng bài.

## Kiểm tra hiện tại

- Prettier: pass.
- ESLint: pass.
- TypeScript: pass.
- Vitest: 31 unit tests pass; database integration test riêng pass trên Supabase.
- Next.js production build: pass.
- Local API smoke: `/api/pages`, `/api/posts`, `/api/facebook/status` đều trả 200.
- Routes build được: health/config, Page sync/list, draft CRUD, publish và schedule.
- Secret exposure scan trên client bundle/source/docs/scripts: pass.

## Chưa implement hoặc chưa xác minh

- Token rotation utility hoàn chỉnh.
- Meta write capability smoke test với Page được người vận hành chọn.
- Remote list/reschedule/cancel services và reconciliation.
- UI xác nhận publish/lên lịch.
- Access gateway production thực tế.
- AI content assistant và single-image support.

## Secret cần cấu hình tiếp theo

Tạo `.env.local` từ `.env.example`, sau đó tự điền:

```text
DATABASE_URL
DIRECT_DATABASE_URL
TOKEN_ENCRYPTION_KEY
APP_ACCESS_SECRET
```

Đã đến capability gate. Trước lần gọi Meta thật cần cấu hình:

```text
FACEBOOK_APP_ID
FACEBOOK_APP_SECRET
FACEBOOK_GRAPH_API_VERSION
FACEBOOK_USER_ACCESS_TOKEN
```

Không gửi các giá trị này vào chat và không commit `.env.local`.
