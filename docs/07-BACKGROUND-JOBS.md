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
- Work: search exact Page/time/fingerprint evidence; resolve scheduled/published/not-found/ambiguous.
- Safety: never creates another post.

### `assets.cleanup`

- Trigger: mỗi ngày một lần qua `GET` hoặc `POST /api/cron/assets/cleanup`.
- Authentication: dedicated `ASSET_CLEANUP_SECRET` bearer token, tối thiểu 32 ký tự.
- Batch: tối đa 50 asset mỗi lần; run tiếp theo xử lý phần còn lại.
- Eligible: asset mồ côi quá 1 giờ hoặc toàn bộ post liên kết đều `published` quá 7 ngày.
- Protected: `draft`, `submitting`, `scheduled`, `failed` và `uncertain` không đủ điều kiện.
- Concurrency: claim lease 15 phút; kiểm tra lại eligibility ngay lúc claim; lỗi Storage sẽ bỏ claim để retry.
- Scope: chỉ Supabase Storage và metadata nội bộ, không gọi mutation Facebook.

### `ai.generate-content`

- Trigger: operator request.
- MVP may execute request-time with strict timeout; move to a durable runner only if latency requires.
- Persists generation/result/cost before applying to draft.

## Cron endpoint

- Protected by dedicated secret/signature.
- Claims Page sync lease to prevent overlap.
- Bounded Page batches and pagination.
- Logs safe IDs/status only.
- Failure leaves cursor unchanged and is visible in Settings.

## Suggested cadence

- Scheduled posts: every 5–15 minutes while schedules exist, configurable.
- Published posts: every 15–60 minutes, plus manual refresh.
- Pages/token health: daily or before write when last validation is stale.
- Image cleanup: daily.

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
