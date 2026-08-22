# Han Content OS

Công cụ nội bộ cho nhóm nhỏ để soạn, đăng và hẹn giờ bài viết Facebook Page bằng Meta Graph API chính thức. Nhân sự đăng nhập Google qua Supabase; Facebook token chỉ nằm ở server.

## Trạng thái

Foundation và local application slice đã được triển khai. Repository có Next.js, strict TypeScript, Supabase/Drizzle repositories, draft CRUD, encrypted Page credential flow và Meta adapter chưa kết nối credential thật.

## Yêu cầu

- Node.js 24 trở lên.
- pnpm 11.22.0 qua Corepack.
- Supabase PostgreSQL project khi bắt đầu migration/integration.

## Khởi động local

```bash
corepack enable
pnpm install
cp .env.example .env.local
# corepack pnpm dev
corepack pnpm exec next start -H 127.0.0.1
```

Trên máy Windows không có quyền tạo Corepack shim toàn cục, dùng `corepack pnpm` thay cho `pnpm`.

Không cần điền Facebook hoặc database secret để build giao diện foundation. Tính năng tương ứng sẽ fail fast khi được gọi mà thiếu cấu hình.

## Quality gates

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Database

Đặt Supabase pooled URL vào `DATABASE_URL` và direct URL vào `DIRECT_DATABASE_URL`, sau đó:

```bash
pnpm db:generate
pnpm db:migrate
```

Không commit `.env.local`. Không đưa database URL, Meta token, App Secret hoặc encryption key vào issue, log hay AI prompt.

## Private image storage

Tạo bucket private `post-assets` trong Supabase Storage, sau đó đặt `SUPABASE_SERVICE_ROLE_KEY` và `SUPABASE_STORAGE_BUCKET=post-assets` trong `.env.local`. Service-role key chỉ được đọc ở server, tuyệt đối không dùng tiền tố `NEXT_PUBLIC_` hoặc gửi key này cho nhân sự.

Ảnh của draft được giữ tới khi draft bị xóa. Ảnh của bài đã đăng được giữ 7 ngày kể từ thời điểm Facebook xác nhận bài ở trạng thái `published`; bài `scheduled`, `failed` và `uncertain` không bị dọn. Endpoint `GET/POST /api/cron/assets/cleanup` chạy batch tối đa 50 ảnh và yêu cầu `Authorization: Bearer <ASSET_CLEANUP_SECRET>`. Đặt một secret ngẫu nhiên tối thiểu 32 ký tự trong `.env.local`, rồi cấu hình scheduler gọi endpoint mỗi ngày một lần.

## Tài liệu

- [Product overview](docs/00-PRODUCT-OVERVIEW.md)
- [Architecture](docs/01-ARCHITECTURE.md)
- [Meta integration](docs/05-FACEBOOK-META-INTEGRATION.md)
- [Next steps](docs/NEXT-STEPS.md)
- [Backlog](TODO.md)
