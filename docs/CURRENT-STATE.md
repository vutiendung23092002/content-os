# CURRENT STATE

**Kiểm tra tại:** 2026-08-26
**Workspace:** `C:\Users\Dung\Documents\Project\han-content-os`

## Kết luận

MVP nội bộ đã chạy được bằng Docker Compose với Supabase Cloud và Cloudflare Tunnel. Luồng đăng ngay/hẹn giờ native cho ảnh, nhiều ảnh và video thường đã được xác minh trên Page test; cron chỉ đồng bộ/đối soát và không tự đăng bài tại giờ hẹn.

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
- Supabase Google OAuth SSR với PKCE callback, cookie phiên do Supabase quản lý và logout cùng origin.
- Allowlist email trong `app_users`; API kiểm tra lại trạng thái duyệt trong database ở mỗi request nên khóa tài khoản có hiệu lực ngay.
- `INITIAL_ADMIN_EMAIL` bootstrap Super Admin được bảo vệ; Super Admin bổ nhiệm thêm Admin, còn Admin duyệt hoặc tạm khóa nhân viên.
- `APP_ACCESS_SECRET` không còn xuất hiện trên màn hình đăng nhập; chỉ giữ tùy chọn cho automation/break-glass server-to-server.
- Phân quyền Page theo tài khoản Google; Super Admin có toàn bộ Page, Admin/Nhân viên chỉ dùng Page được gán và API chặn truy cập chéo Page.
- Màn Nhân sự có thống kê, directory tài khoản và drawer tìm/gán Page với Liquid Glass nền đục.
- Design system Liquid Glass đã được áp dụng toàn bộ giao diện, gồm sidebar/topbar, dashboard, form, bảng, timeline, dropdown và modal; lớp kính giữ độ đục cao để không nhìn xuyên dữ liệu.
- Topbar đã được bỏ; tài khoản Google nằm ở cuối sidebar, menu chỉ giữ thông tin tài khoản và đăng xuất. Indicator sidebar theo cả click trực tiếp lẫn điều hướng từ link trong nội dung.
- Mọi tài khoản đã duyệt có thể kiểm tra/thêm Page bằng ID nhưng không tự nhận quyền sử dụng; Admin/Super Admin có thể gỡ Page khỏi danh mục bằng soft-delete nội bộ, thu hồi assignment và không tác động Facebook.

### Database

- Cả pooled `DATABASE_URL` và migration `DIRECT_DATABASE_URL` đã kết nối thành công.
- Drizzle schema `hancontent_os` cho 12 bảng hiện hành, gồm `app_users`, `user_page_assignments` và `cron_jobs` phục vụ allowlist, phạm vi Page và lease/cursor cron.
- Enum, foreign key, unique/index và check constraint cốt lõi.
- Supabase-compatible runtime client dùng pooled URL với prepared statement tắt.
- Drizzle config dùng direct URL cho migration.
- Migration nền, Google allowlist và Page assignment: `0000_empty_human_cannonball.sql`, `0001_whole_stepford_cuckoos.sql`, `0002_curious_kitty_pryde.sql`.
- Migration đã áp dụng thành công lên Supabase.
- Catalog verification xác nhận đủ bảng hiện hành; ba bảng OAuth thử nghiệm cũ được giữ nguyên, không dùng và không xóa để tránh thao tác phá hủy dữ liệu.

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
- Reconciliation cho publish/schedule đã dùng intent metadata tối thiểu và remote evidence; chỉ một candidate chính xác mới được tự chốt, còn no-match/ambiguous/incomplete/visibility-window đều chuyển `needs_attention`. Admin resolution được audit theo user và không có blind retry.
- Local UI `/posts` và `/posts/new`.
- Composer `/posts/new` đã có Page picker kèm avatar, caption editor chừa sẵn AI tools, upload tối đa 10 ảnh hoặc một video MP4/MOV, preview theo thiết bị, lưu draft, đăng ngay và hẹn giờ native Facebook với bước xác nhận cuối.
- Ảnh được lưu trong private Supabase Storage, metadata/checksum nằm trong `assets`, thứ tự nằm trong `post_assets`; Meta adapter dùng unpublished photos và `attached_media` cho bài nhiều ảnh.
- Video dùng signed upload trực tiếp lên private Supabase Storage, sau đó Meta adapter gửi signed `file_url` vào Page `/videos`; video thường và Reel được tách riêng.
- Asset cleanup đã có endpoint cron riêng, lease chống chạy chồng và policy tối ưu quota: orphan quá 1 giờ; ảnh dọn ở lượt kế tiếp sau khi Facebook xác nhận thành công; video giữ thêm 24 giờ; trạng thái chưa thành công/chưa chắc chắn được bảo vệ. Migration cleanup `0003_steep_hex.sql` và reconciliation `0005_exotic_shinko_yamashiro.sql` đã áp dụng trên Supabase.
- FB-011 có hai cron read-only đồng bộ published/native scheduled và đối soát operation bất định. `cron_jobs` giữ lease/cursor, retry hữu hạn và không có publish worker; migration `0006_faithful_spitfire.sql` đã áp dụng lên Supabase.
- Docker Compose chạy `facebook-cron` mỗi 10 phút và `asset-cleanup` mỗi giờ; log thực tế xác nhận cả hai job hoàn tất thành công.
- UI `/posts` đọc trực tiếp bài đã đăng/hẹn giờ theo Page, hỗ trợ phân trang, làm mới và chuyển đổi giữa dạng bảng với timeline tuần.
- Timeline cache theo Page/tab/tuần ở client và mirror bài remote vào Supabase; published sync dùng `since/until`, request trùng được hợp nhất và dữ liệu stale hiển thị trước khi refresh nền.

Meta contracts vẫn có mock tests. Read-only discovery trên Graph API `v26.0` đã thành công: 6 Page được đồng bộ, Page token mã hóa trong Supabase và response không chứa credential. Năm Page có `CREATE_CONTENT`/`MANAGE`; một Page chỉ có `ANALYZE`/`ADVERTISE` nên không được dùng để test đăng bài.

## Kiểm tra hiện tại

- Prettier: pass.
- ESLint: pass.
- TypeScript: pass.
- Vitest: 128 tests pass; 3 database integration tests pass và rollback/dọn sạch dữ liệu test.
- Next.js production build: pass.
- Local production smoke: chưa đăng nhập bị chuyển về `/login`; API trả 401; endpoint mật khẩu nội bộ cũ trả 404.
- Read-only Facebook smoke: Page Naturally Việt Nam trả 50 bài đã đăng và cursor; scheduled list trả thành công; response không chứa credential.
- Read-only week-window smoke trên Graph API `v26.0`: Hân Korea trả 81 bài đúng tuần trong một request `limit=100`, không có trang tiếp theo và toàn bộ timestamp nằm trong `since/until`.
- Live cache smoke với cùng 81 bài: refresh từ Meta khoảng 5,5 giây; đọc lại snapshot tuần từ Supabase khoảng 0,43 giây.
- Private Supabase Storage bucket `post-assets` đã được tạo cho JPEG/PNG/WebP và một video MP4/MOV tối đa 50 MB; upload và cleanup smoke thành công qua localhost lẫn Cloudflare Tunnel.
- Live write smoke trên Page test Nero Team thành công với một bài có ảnh; operation local ở trạng thái `succeeded` và remote post ID đã được lưu để đối soát.
- Live smoke đăng ngay/hẹn giờ native nhiều ảnh và video thường trên Page test đã thành công; scheduled preview đọc đầy đủ `attachments/subattachments`.
- Routes build được: health/config, Page sync/list, draft CRUD, publish và schedule.
- Secret exposure scan trên client bundle/source/docs/scripts: pass.

## Chưa implement hoặc chưa xác minh

- Token rotation utility hoàn chỉnh.
- Phần còn lại của Meta capability smoke: reschedule và cancel trên Page test.
- Remote reschedule/cancel services.
- Mutation hardening/rate limit cần được rà đầy đủ trước khi chốt production readiness.
- Token rotation utility, runbook sự cố, metrics/alert và bài kiểm tra backup/restore chưa hoàn chỉnh.
- AI content assistant và Reel publishing chưa triển khai; không chặn phạm vi MVP hiện tại.

## Secret cần cấu hình tiếp theo

Tạo `.env.local` từ `.env.example`, sau đó tự điền:

```text
DATABASE_URL
DIRECT_DATABASE_URL
TOKEN_ENCRYPTION_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
ASSET_CLEANUP_SECRET
FACEBOOK_CRON_SECRET
NEXT_PUBLIC_SITE_URL
INITIAL_ADMIN_EMAIL
```

`APP_ACCESS_SECRET` là tùy chọn server-to-server, không cung cấp cho nhân sự.

Meta integration cần các biến server-only sau:

```text
FACEBOOK_APP_ID
FACEBOOK_APP_SECRET
FACEBOOK_GRAPH_API_VERSION
FACEBOOK_USER_ACCESS_TOKEN
```

Không gửi các giá trị này vào chat và không commit `.env.local`.
