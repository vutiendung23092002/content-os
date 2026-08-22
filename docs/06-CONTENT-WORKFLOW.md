# Content workflow

## States

```text
draft
  ├── publish now -> submitting -> published | failed | uncertain
  └── schedule    -> submitting -> scheduled | failed | uncertain

scheduled
  ├── remote publishes -> published
  ├── reschedule/edit  -> scheduled
  ├── cancel/delete    -> canceled
  └── missing remote   -> published | deleted_remote | uncertain
```

No review/approval/assignment/comment workflow in MVP. The operator is the human authority.

## Create and edit draft

- Draft is local and may have AI-generated or manually edited message.
- Tối đa 10 ảnh phải upload xong và được gắn vào draft theo đúng thứ tự trước khi publish/schedule.
- Editing a local draft does not affect Meta until an explicit action.

## Publish now

1. Operator previews Page, message and media.
2. Explicit confirmation.
3. Insert `facebook_operations(pending)` and set local `submitting`.
4. Với bài nhiều ảnh, upload từng ảnh dạng `published=false`, sau đó tạo một Page feed post bằng danh sách `attached_media` theo thứ tự đã chọn.
5. On success store remote ID, `published` and sync snapshot.
6. On known rejection set `failed`; on ambiguous timeout set `uncertain` and reconcile before retry.

## Schedule native on Facebook

1. Operator chooses local date/time/timezone.
2. Server converts/validates UTC time and Meta configured window.
3. Call Meta immediately with `published=false` và `scheduled_publish_time`; bài nhiều ảnh dùng các `media_fbid` đã upload trong `attached_media`.
4. Store remote ID only after Meta success.
5. Refetch `/scheduled_posts`; display remote-confirmed schedule.

There is no local transition that claims `scheduled` before Meta accepts it.

Facebook tự quyết định cách ghép layout ảnh cuối cùng. Công cụ chỉ đảm bảo thứ tự ảnh và hiển thị preview gần đúng, không cung cấp tùy chọn layout giả mà Graph API không hỗ trợ.

## Image retention

- Draft giữ ảnh cho tới khi draft bị xóa. Asset không còn gắn với post được dọn sau grace period 1 giờ.
- Bài `published` giữ ảnh 7 ngày tính từ `published_at`, sau đó cleanup chỉ xóa object Supabase và soft-delete metadata.
- Bài `scheduled` chỉ bắt đầu đếm 7 ngày sau khi sync Facebook xác nhận và chuyển local state thành `published`; không suy đoán theo `scheduled_at`.
- Bài `failed` hoặc `uncertain` không tự xóa ảnh để còn retry/đối soát.
- Cleanup không gọi API xóa, sửa hoặc ẩn bài trên Facebook.

## Edit/reschedule

- Remote ID required.
- Fetch current remote state before mutation when local cache is stale.
- Send only fields supported by the pinned version/content type.
- Refetch after mutation and replace local mirror.
- If already published, do not pretend reschedule succeeded.

## Cancel/delete

- Confirmation shows Page, time and excerpt.
- Delete remote PagePost using remote ID.
- Refetch scheduled list.
- Mark local `canceled` only after confirmed success/not-found evidence that is not published.
- Tool never deletes an already published remote post unless a separate future feature explicitly enables it.

## List views

- Drafts: PostgreSQL.
- Scheduled: remote `/scheduled_posts`, enriched by local AI/draft metadata.
- Published: remote Page posts, cached locally.
- Failed/uncertain: local operations requiring operator action.

Every remote-backed view shows `last_synced_at` and a refresh action.

## Concurrency and idempotency

- Disable/dedupe double-click with a client request ID and local unique operation fingerprint.
- Concurrent update uses local version/remote fetch.
- A timed-out create operation is never automatically repeated without reconciliation.

## Edge cases

| Case                                   | Behavior                                                    |
| -------------------------------------- | ----------------------------------------------------------- |
| Token expires before schedule creation | Fail, replace token, no local scheduled claim               |
| App goes offline after Meta accepts    | Facebook still publishes; later sync repairs local state    |
| User edits in Meta Business Suite      | Sync adopts remote version and flags remote change          |
| User deletes scheduled post in Meta    | Mark deleted_remote/canceled after reconciliation           |
| Scheduled time passes but post absent  | Query published + scheduled before showing failure          |
| DB fails after Meta success            | Recover by remote list/fingerprint; do not recreate blindly |
