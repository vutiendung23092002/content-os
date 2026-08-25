# Han Content OS

Công cụ nội bộ cho nhóm nhỏ để soạn, đăng và hẹn giờ bài viết Facebook Page bằng Meta Graph API chính thức. Nhân sự đăng nhập Google qua Supabase; Facebook token chỉ nằm ở server.

## Trạng thái

Foundation và local application slice đã được triển khai. Repository có Next.js, strict TypeScript, Supabase/Drizzle repositories, draft CRUD, encrypted Page credential flow và Meta adapter chưa kết nối credential thật.

## Yêu cầu

- Node.js 24 trở lên.
- pnpm 11.22.0 qua Corepack.
- Supabase PostgreSQL project khi bắt đầu migration/integration.

## Cài đặt lần đầu

Trên máy Windows không có quyền tạo Corepack shim toàn cục, không cần chạy `corepack enable`. Dùng trực tiếp `corepack pnpm` cho tất cả lệnh pnpm:

```bash
corepack pnpm install
```

Tạo file cấu hình local từ file mẫu:

```bash
# Git Bash
cp .env.example .env.local
```

```powershell
# PowerShell
Copy-Item .env.example .env.local
```

Điền các biến môi trường cần thiết vào `.env.local`. Không commit file này lên Git.

## Chạy khi phát triển

Chế độ phát triển tự cập nhật giao diện sau khi sửa code, không cần build lại:

```bash
corepack pnpm dev
```

Mở [http://localhost:3000](http://localhost:3000). Dừng server bằng `Ctrl+C` tại cửa sổ terminal đang chạy.

## Chạy bản production và Cloudflare Tunnel

Cloudflare Tunnel hiện trỏ tới `127.0.0.1:3000`, vì vậy chạy ứng dụng bằng:

```bash
corepack pnpm build
corepack pnpm exec next start -H 127.0.0.1
```

`next start` chỉ phục vụ bản đã được tạo bởi lệnh `build`. Sau mỗi lần sửa code, phải dừng server bằng `Ctrl+C`, build lại rồi khởi động lại:

```bash
corepack pnpm build
corepack pnpm exec next start -H 127.0.0.1
```

Không cần tạo lại route hay khởi động lại Cloudflare Tunnel nếu hostname và địa chỉ `127.0.0.1:3000` không đổi.

### Lỗi cổng 3000 đang được sử dụng

Nếu gặp `EADDRINUSE: address already in use 127.0.0.1:3000`, một tiến trình khác vẫn đang chạy trên cổng 3000.

Kiểm tra PID bằng PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
```

Ưu tiên quay lại terminal cũ và nhấn `Ctrl+C`. Nếu không còn terminal đó, xem đúng tiến trình trước khi dừng:

```powershell
Get-Process -Id <PID>
Stop-Process -Id <PID>
```

Sau đó chạy lại lệnh `next start` ở trên.

Không cần điền Facebook hoặc database secret chỉ để build giao diện. Tính năng tương ứng sẽ báo lỗi khi được gọi mà thiếu cấu hình.

## Quality gates

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Database

Đặt Supabase pooled URL vào `DATABASE_URL` và direct URL vào `DIRECT_DATABASE_URL`, sau đó:

```bash
corepack pnpm db:generate
corepack pnpm db:migrate
```

Không commit `.env.local`. Không đưa database URL, Meta token, App Secret hoặc encryption key vào issue, log hay AI prompt.

## Private media storage

Tạo bucket private `post-assets` trong Supabase Storage, sau đó đặt `SUPABASE_SERVICE_ROLE_KEY` và `SUPABASE_STORAGE_BUCKET=post-assets` trong `.env.local`. Service-role key chỉ được đọc ở server, tuyệt đối không dùng tiền tố `NEXT_PUBLIC_` hoặc gửi key này cho nhân sự.

Bucket cần giới hạn file `50 MB` và cho phép `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime`. Video được tải thẳng từ trình duyệt lên Storage bằng signed upload token; service-role key không đi xuống browser. Nếu bucket cũ vẫn giới hạn 10 MB/chỉ cho ảnh, phải cập nhật cấu hình bucket trước khi thử video.

```bash
corepack pnpm storage:configure
```

Media của draft được giữ tới khi draft bị xóa. Media của bài đã đăng được giữ 7 ngày kể từ thời điểm Facebook xác nhận bài ở trạng thái `published`; bài `scheduled`, `failed` và `uncertain` không bị dọn. Endpoint `GET/POST /api/cron/assets/cleanup` chạy batch tối đa 50 asset và yêu cầu `Authorization: Bearer <ASSET_CLEANUP_SECRET>`. Đặt một secret ngẫu nhiên tối thiểu 32 ký tự trong `.env.local`, rồi cấu hình scheduler gọi endpoint mỗi ngày một lần.

## Tài liệu

- [Product overview](docs/00-PRODUCT-OVERVIEW.md)
- [Architecture](docs/01-ARCHITECTURE.md)
- [Meta integration](docs/05-FACEBOOK-META-INTEGRATION.md)
- [Next steps](docs/NEXT-STEPS.md)
- [Backlog](TODO.md)
