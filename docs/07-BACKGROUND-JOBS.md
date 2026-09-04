# Background and synchronization jobs

## Decision

No background worker publishes a scheduled post at its due time. Facebook native scheduling owns execution.

MVP background work is reconciliation only and may use Vercel Cron or host cron. Trigger.dev is deferred.

## Jobs

### `facebook.sync-pages`

- Trigger: manual Settings action; optional daily.
- Input: none/token loaded server-side.
- Work: `/me/accounts`, validate tasks, upsert Pages, rotate encrypted Page credentials.
- Idempotency: external Page ID.
- Retry: bounded transient 429/5xx; no retry on invalid token/permission.

### `facebook.sync-scheduled-posts`

- Trigger: manual refresh and periodic cron.
- Input: Page ID.
- Work: fetch `/scheduled_posts`, upsert remote mirror, detect missing/changed posts.
- Idempotency: `(page_id,remote_post_id)`.
- Concurrency: one sync per Page.

### `facebook.sync-published-posts`

- Trigger: manual refresh and periodic cron.
- Input: Page ID + cursor/window.
- Work: fetch recent published posts, upsert and advance checkpoint.
- Idempotency: remote post ID.

### `facebook.reconcile-operation`

- Trigger: create request timeout, DB-after-Meta failure or manual action.
- Input: operation ID.
- Work: search exact Page/time/fingerprint evidence; resolve scheduled/published/not-found/ambiguous. App A-origin operation dùng exact stored App A provenance; App B-origin operation không được cron remote-read và chuyển `needs_attention` chờ actor/Admin reconciliation bằng exact stored provenance. Legacy operation thiếu provenance chỉ dùng App A.
- Safety: never creates another post.

### `assets.cleanup`

- Trigger: mỗi giờ một lần trong Docker qua `GET` hoặc `POST /api/cron/assets/cleanup`.
- Authentication: dedicated `ASSET_CLEANUP_SECRET` bearer token, tối thiểu 32 ký tự.
- Batch: tối đa 50 asset mỗi lần; run tiếp theo xử lý phần còn lại.
- Eligible: asset mồ côi quá 1 giờ; ảnh của operation Facebook thành công ở lượt cleanup kế tiếp; video sau 24 giờ kể từ khi operation Facebook thành công.
- Protected: `draft`, `submitting`, `failed`, `uncertain`, `needs_attention`, operation chưa `succeeded`, và video thành công chưa đủ 24 giờ.
- Concurrency: claim lease 15 phút; kiểm tra lại eligibility ngay lúc claim; lỗi Storage sẽ bỏ claim để retry.
- Scope: chỉ Supabase Storage và metadata nội bộ, không gọi mutation Facebook.

### `ai.generate-content`

- Trigger: operator request.
- MVP may execute request-time with strict timeout; move to a durable runner only if latency requires.
- Persists generation/result/cost before applying to draft.

## Cron endpoints đã triển khai

- `GET/POST /api/cron/sync-facebook`: đọc bài published gần đây và lịch native trong 30 ngày, rồi upsert mirror nội bộ.
- `GET/POST /api/cron/reconcile-operations`: đối soát operation `uncertain` hoặc stale `pending`; không tự chạy lại create.
- Cả hai yêu cầu `Authorization: Bearer <FACEBOOK_CRON_SECRET>` với secret tối thiểu 32 ký tự.
- `cron_jobs` giữ lease toàn cục, checkpoint cursor sau từng Page/operation và cho phép owner mới nhận lại lease đã stale.
- Mỗi lần sync tối đa 5 Page mặc định, 10 trang Graph cho mỗi loại dữ liệu và 2 lần đọc khi lỗi tạm thời.
- Sync cron chỉ dùng App A. Page chỉ có App B hoặc không có admin credential usable
  được đếm `pagesSkippedNoAdminCredential`, checkpoint và bỏ qua để Page sau vẫn chạy;
  không load hoặc tạo client App B. Lỗi Graph tạm thời trên App A vẫn fail/retry như cũ.
- Lỗi từng phần giữ checkpoint đã hoàn tất. `needs_attention` không bị cron chạy lặp lại.
- Response/log chỉ có trạng thái, số lượng và mã lỗi an toàn; không log token, secret hoặc signed URL.
- Không endpoint nào chứa lệnh đăng/sửa/xóa Facebook. Facebook native scheduling vẫn tự đăng kể cả app dừng đúng giờ publish.

Host Windows gọi cả hai endpoint bằng:

```bash
corepack pnpm facebook:cron
```

Đặt lịch Windows Task Scheduler chạy lệnh trên mỗi 10–15 phút trong thư mục project. Script ưu tiên `FACEBOOK_CRON_BASE_URL`, nếu không có sẽ dùng `NEXT_PUBLIC_SITE_URL`. Không chạy scheduler ngắn hơn thời gian hoàn tất thông thường; lease vẫn chặn hai lần chạy chồng.

## Suggested cadence

- Scheduled/reconciliation mirror: every 10–15 minutes.
- Published posts: cùng cron 10–15 phút, cộng thêm manual refresh khi người dùng yêu cầu.
- Pages/token health: daily or before write when last validation is stale.
- Media cleanup: hourly when using the Docker stack.

Exact cadence depends on rate limits and number of Pages.

## Retry policy

- Retry 429/known transient 5xx/network with exponential backoff + jitter.
- Do not retry invalid token, missing permission, invalid media/time/content.
- A timeout after create/update is ambiguous; reconcile remote state first.

## Observability

Track sync success/failure/duration, last successful sync, records upserted, token health and unresolved operations. Never log access tokens, authorization headers or signed media URLs.

## Upgrade trigger

Consider Trigger.dev only when one of these is measured:

- AI/image requests exceed request lifecycle.
- Many Pages/backfills need durable batching.
- Cron/retry reliability is insufficient.

Even then, native Facebook schedules remain remote; Trigger does not replace them.
