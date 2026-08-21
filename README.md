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
pnpm dev
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

## Tài liệu

- [Product overview](docs/00-PRODUCT-OVERVIEW.md)
- [Architecture](docs/01-ARCHITECTURE.md)
- [Meta integration](docs/05-FACEBOOK-META-INTEGRATION.md)
- [Next steps](docs/NEXT-STEPS.md)
- [Backlog](TODO.md)
