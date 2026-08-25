# Setup Docker

Tài liệu này hướng dẫn chạy Han Content OS bằng Docker Compose trên Windows. Supabase tiếp tục chạy trên cloud; không đưa PostgreSQL, Auth hay Storage xuống Docker local.

## 1. Kiến trúc container

Compose chạy ba service từ cùng một image:

- `app`: Next.js standalone server.
- `facebook-cron`: gọi tác vụ đối soát Facebook mỗi 10 phút.
- `asset-cleanup`: dọn media tạm mỗi ngày.

Cloudflare Tunnel tiếp tục chạy như Windows service và chuyển request đến cổng publish của container `app`.

## 2. Yêu cầu

- Docker Desktop đang chạy.
- Docker Compose v2 (`docker compose`).
- File `.env.local` đã được cấu hình theo [hướng dẫn local](16-LOCAL-SETUP.md).
- Database migration và Storage đã được khởi tạo.

Kiểm tra:

```powershell
docker version
docker compose version
```

## 3. Chọn cổng

Thêm vào `.env.local`:

```dotenv
HAN_CONTENT_PORT=3210
NEXT_PUBLIC_SITE_URL=https://social.example.com
FACEBOOK_CRON_BASE_URL=http://app:3000
```

Compose ánh xạ `127.0.0.1:3210` trên máy host vào cổng `3000` bên trong container `app`. Vì vậy:

- `3210` là cổng truy cập từ Windows và Cloudflare Tunnel.
- `app` là tên service kiêm DNS nội bộ của Docker Compose.
- `3000` trong `http://app:3000` là cổng nội bộ của container, không chiếm và không xung đột với cổng `3000` của ứng dụng khác trên Windows.

Khi chuyển sang máy mới, có thể giữ nguyên `FACEBOOK_CRON_BASE_URL=http://app:3000`. Nếu cổng host `3210` bị chiếm, chỉ cần đổi `HAN_CONTENT_PORT` và route Cloudflare; không cần đổi địa chỉ nội bộ này.

Chỉ dùng URL host hoặc domain public cho `FACEBOOK_CRON_BASE_URL` khi chạy cron bên ngoài Docker. Với mô hình chạy toàn bộ bằng Compose, địa chỉ nội bộ `http://app:3000` là lựa chọn khuyến nghị.

Không đưa secret vào `Dockerfile`, `compose.yaml` hoặc build args. Compose đọc chúng từ `.env.local` lúc khởi chạy.

## 4. Kiểm tra trước khi build

Xác nhận cấu hình Compose hợp lệ mà không in secret ra màn hình:

```powershell
docker compose --env-file .env.local config --quiet
```

Kiểm tra cổng `3210` đang trống:

```powershell
Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue
```

Khuyến nghị chạy quality gate trước:

```powershell
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

## 5. Tránh chạy trùng tiến trình

Trước khi bật Docker:

- Dừng tiến trình `next start` cũ của Han Content OS.
- Tắt Windows Task Scheduler đang chạy `facebook:cron` hoặc `assets:cleanup` cho dự án này.
- Không dừng container/dịch vụ CRM đang dùng cổng `3000` và `3001`.

Mỗi tác vụ cron chỉ nên có một scheduler chủ động.

## 6. Build image

```powershell
docker compose --env-file .env.local build app
```

`.dockerignore` loại `.env.local`, `.git`, `.next` và `node_modules` khỏi build context. Image production chạy Next.js standalone bằng user không phải root.

## 7. Khởi động stack

```powershell
docker compose --env-file .env.local up -d --build
```

Hai service cron chờ `app` healthy trước khi bắt đầu. Kiểm tra trạng thái:

```powershell
docker compose --env-file .env.local ps
```

Kiểm tra health local:

```powershell
Invoke-RestMethod http://127.0.0.1:3210/api/health
```

Xem log mà không in toàn bộ cấu hình môi trường:

```powershell
docker compose --env-file .env.local logs --tail 100 app
docker compose --env-file .env.local logs --tail 100 facebook-cron
docker compose --env-file .env.local logs --tail 100 asset-cleanup
```

Compose giới hạn log theo vòng quay để tránh tăng dung lượng không kiểm soát.

## 8. Chuyển Cloudflare Tunnel

Chỉ đổi route sau khi local health check thành công.

Trong Cloudflare Tunnel, cấu hình hostname:

```text
https://social.example.com -> http://127.0.0.1:3210
```

Giữ các cấu hình OAuth public:

- Supabase Site URL: `https://social.example.com`
- Supabase Redirect URL: `https://social.example.com/auth/callback`
- Google Authorized JavaScript origin: `https://social.example.com`
- Google redirect URI vẫn là callback Supabase: `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`

## 9. Kiểm tra cron

Chạy một lượt thủ công bên trong container:

```powershell
docker compose --env-file .env.local exec facebook-cron node scripts/run-facebook-cron.mjs
docker compose --env-file .env.local exec asset-cleanup node scripts/run-asset-cleanup.mjs
```

Sau đó kiểm tra log để xác nhận tác vụ kết thúc bình thường. Không cần mở thêm CMD riêng cho cron khi các container đã chạy.

## 10. Vận hành hàng ngày

Xem trạng thái:

```powershell
docker compose --env-file .env.local ps
```

Khởi động lại:

```powershell
docker compose --env-file .env.local restart
```

Dừng nhưng giữ container:

```powershell
docker compose --env-file .env.local stop
```

Chạy lại:

```powershell
docker compose --env-file .env.local start
```

Gỡ container/network của stack:

```powershell
docker compose --env-file .env.local down
```

Lệnh `down` không xóa dữ liệu Supabase Cloud. Không thêm `-v` nếu chưa xác định rõ volume cần xóa.

## 11. Cập nhật phiên bản

Sau khi pull code mới:

```powershell
git pull
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.local ps
```

Nếu có migration mới, chạy migration có kiểm soát trước khi đưa phiên bản mới vào sử dụng:

```powershell
corepack pnpm db:migrate
corepack pnpm db:verify
```

## 12. Rollback sang Node trực tiếp

```powershell
docker compose --env-file .env.local down
corepack pnpm build
corepack pnpm exec next start -H 127.0.0.1 -p 3210
```

Cloudflare vẫn trỏ vào `127.0.0.1:3210`, nên không cần đổi route nếu Node trực tiếp dùng cùng cổng.

## 13. Xử lý lỗi thường gặp

### Bind port thất bại

Cổng host đã bị chiếm. Kiểm tra PID và chỉ dừng đúng tiến trình Han Content OS, hoặc đổi `HAN_CONTENT_PORT` sang cổng trống rồi cập nhật route Cloudflare.

### `app` unhealthy

```powershell
docker compose --env-file .env.local logs --tail 200 app
docker compose --env-file .env.local exec app node -e "fetch('http://127.0.0.1:3000/api/health').then(async r => console.log(r.status, await r.text()))"
```

### Cron không chạy

Kiểm tra `FACEBOOK_CRON_SECRET`, `ASSET_CLEANUP_SECRET`, base URL và health của `app`. Không log giá trị secret.

### Thay `NEXT_PUBLIC_*` nhưng giao diện vẫn dùng giá trị cũ

Các biến public được đóng vào bundle lúc build. Chạy lại:

```powershell
docker compose --env-file .env.local up -d --build
```

### Docker Desktop khởi động chậm

Chờ Docker Engine sẵn sàng rồi chạy lại `docker compose ... up -d`; không cần sửa code.

## Checklist Docker

- [ ] `.env.local` dùng cổng `3210` và domain mới.
- [ ] Compose config hợp lệ.
- [ ] Không có Node server hoặc Windows cron cũ chạy trùng.
- [ ] Image build thành công và không chứa `.env.local`.
- [ ] `app` healthy tại `127.0.0.1:3210`.
- [ ] Cloudflare route trỏ đúng cổng.
- [ ] Google OAuth/Supabase callback quay về domain mới.
- [ ] Hai cron container hoạt động và không bị nhân đôi scheduler.
- [ ] Luồng đăng nhập, xem Page, đăng Page test và hẹn giờ Page test được kiểm tra có kiểm soát.
