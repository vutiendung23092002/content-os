# Setup local

Tài liệu này hướng dẫn chạy Han Content OS trực tiếp bằng Node.js trên Windows. Database, Google Auth và Storage vẫn dùng Supabase Cloud.

## 1. Yêu cầu

- Windows 10/11 và PowerShell.
- Git.
- Node.js 24.x.
- Corepack đi kèm Node.js.
- Một dự án Supabase Cloud.
- Meta App, Facebook user access token dài hạn và quyền trên các Page cần quản lý.
- Google Cloud OAuth client dùng cho đăng nhập qua Supabase.
- Cloudflare Tunnel nếu cần public ứng dụng từ máy local.

Kiểm tra công cụ:

```powershell
node --version
corepack --version
git --version
```

Nếu `corepack enable` báo `EPERM`, không bắt buộc phải enable toàn cục. Các lệnh trong dự án có thể chạy qua `corepack pnpm ...`.

## 2. Cài dependency

Tại thư mục dự án:

```powershell
corepack pnpm install --frozen-lockfile
```

Tạo file môi trường từ mẫu:

```powershell
Copy-Item .env.example .env.local
```

Không commit `.env.local`.

## 3. Cấu hình môi trường

Điền các giá trị trong `.env.local`. Không dán giá trị thật vào tài liệu, commit, log hoặc ảnh chụp.

### Database

- `DATABASE_URL`: kết nối PostgreSQL qua Supabase pooler, dùng khi ứng dụng chạy.
- `DIRECT_DATABASE_URL`: kết nối trực tiếp, dùng cho migration và tác vụ quản trị. Nếu mạng chỉ hỗ trợ IPv4, dùng endpoint/pooler tương thích do Supabase cung cấp.
- Migration hiện tạo các bảng trong schema riêng `hancontent_os` của ứng dụng.

### Meta/Facebook

- `FACEBOOK_APP_ID`: App ID của Meta App.
- `FACEBOOK_APP_SECRET`: App Secret của Meta App.
- `FACEBOOK_GRAPH_API_VERSION`: phiên bản Graph API đang được dự án hỗ trợ.
- `FACEBOOK_USER_ACCESS_TOKEN`: long-lived user token của tài khoản quản trị gốc.
- `TOKEN_ENCRYPTION_KEY`: khóa base64 32 byte dùng để mã hóa token trước khi lưu.
- `TOKEN_ENCRYPTION_KEY_VERSION`: version số nguyên dương của khóa hiện tại; mặc định `1` để tương thích credential production hiện có.
- `TOKEN_ENCRYPTION_PREVIOUS_KEYS`: JSON map các version cũ sang khóa base64, chỉ cấu hình trong thời gian cần decrypt/rotate credential cũ, ví dụ `{"1":"<old-base64-key>"}`.

### Supabase

- `NEXT_PUBLIC_SUPABASE_URL`: Project URL trong Supabase.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: publishable/anon key cho trình duyệt.
- `SUPABASE_SERVICE_ROLE_KEY`: service-role key, chỉ dùng ở server.
- `SUPABASE_STORAGE_BUCKET`: bucket media của ứng dụng.
- `INITIAL_ADMIN_EMAIL`: email Google được cấp quyền quản trị ban đầu.

### URL và cron

Ví dụ chạy local trên cổng `3210`:

```dotenv
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3210
FACEBOOK_CRON_BASE_URL=http://127.0.0.1:3210
HAN_CONTENT_PORT=3210
```

Khi dùng domain public:

```dotenv
NEXT_PUBLIC_SITE_URL=https://social.example.com
FACEBOOK_CRON_BASE_URL=https://social.example.com
```

Tạo secret ngẫu nhiên bằng PowerShell:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Dùng hai giá trị độc lập cho `FACEBOOK_CRON_SECRET` và `ASSET_CLEANUP_SECRET`.

## 4. Cấu hình Google OAuth

Trong Google Cloud OAuth client:

- Authorized JavaScript origins:
  - `http://127.0.0.1:3210`
  - `https://social.example.com`
- Authorized redirect URI là callback của Supabase, không phải callback của Next.js:
  - `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`

Trong Supabase Authentication > URL Configuration:

- Site URL local: `http://127.0.0.1:3210`, hoặc domain production khi vận hành thật.
- Redirect URLs:
  - `http://127.0.0.1:3210/auth/callback`
  - `https://social.example.com/auth/callback`

Trong Supabase Authentication > Sign In / Providers, bật Google và điền Client ID/Client Secret từ Google Cloud.

## 5. Khởi tạo database

Chạy lần lượt:

```powershell
corepack pnpm db:ping
corepack pnpm db:check
corepack pnpm db:migrate
corepack pnpm db:verify
```

Chỉ chạy `db:generate` khi chủ động thay đổi Drizzle schema và cần tạo migration mới.

## 6. Khởi tạo Storage

```powershell
corepack pnpm storage:configure
corepack pnpm storage:smoke
```

Bucket phải ở chế độ private. Cấu hình hiện tại giới hạn 50 MB/tệp và chấp nhận JPEG, PNG, WebP, MP4, MOV.

## 7. Chạy ứng dụng

### Chế độ phát triển

```powershell
corepack pnpm exec next dev -H 127.0.0.1 -p 3210
```

### Chế độ production local

```powershell
corepack pnpm build
corepack pnpm exec next start -H 127.0.0.1 -p 3210
```

Mở `http://127.0.0.1:3210` và kiểm tra `http://127.0.0.1:3210/api/health`.

Sau khi thay `.env.local` hoặc code production, cần build lại rồi khởi động lại server.

## 8. Chạy cron

Chạy thử thủ công:

```powershell
corepack pnpm facebook:cron
corepack pnpm assets:cleanup
```

- `facebook:cron`: đối soát trạng thái bài với Facebook; khuyến nghị mỗi 10 phút.
- `assets:cleanup`: dọn media đã hết hạn; nếu tự cấu hình scheduler local thì khuyến nghị mỗi giờ.

Khi chạy trực tiếp bằng Node.js, cấu hình Windows Task Scheduler cho hai lệnh trên. Không chạy thêm Task Scheduler nếu Docker Compose đã chạy các container cron tương ứng.

## 9. Kiểm tra trước khi sử dụng

```powershell
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Nếu cần kiểm tra tích hợp database thật:

```powershell
corepack pnpm test:db
```

Không dùng Page thật để thử đăng/sửa/xóa nếu chưa được chủ Page cho phép. Chỉ thao tác ghi trên Page test đã được xác nhận.

## 10. Xử lý lỗi thường gặp

### `pnpm: command not found`

Dùng `corepack pnpm ...` thay cho `pnpm ...`.

### `EADDRINUSE`

Cổng đang có tiến trình khác sử dụng:

```powershell
Get-NetTCPConnection -LocalPort 3210 -State Listen
```

Dừng đúng tiến trình của Han Content OS hoặc chọn cổng khác; không dừng nhầm dịch vụ CRM.

### OAuth quay về domain cũ

Kiểm tra đồng thời:

- `NEXT_PUBLIC_SITE_URL` trong `.env.local`.
- Site URL và Redirect URLs trong Supabase.
- Authorized origins trong Google Cloud.
- Route/hostname của Cloudflare Tunnel.

Sau khi đổi biến `NEXT_PUBLIC_*`, build lại ứng dụng.

### Thay env nhưng ứng dụng chưa nhận

Server đang chạy không tự nạp lại mọi biến môi trường. Hãy dừng server, build lại nếu cần và khởi động lại.

## Checklist local

- [ ] Dependency được cài bằng lockfile.
- [ ] `.env.local` đủ biến và không được Git theo dõi.
- [ ] Database migration và verify thành công.
- [ ] Storage smoke test thành công.
- [ ] Google OAuth quay về đúng domain.
- [ ] `/api/health` trả về thành công.
- [ ] Lint, test và build đều qua.
- [ ] Cron đã được chạy thử và có lịch tự động phù hợp.
