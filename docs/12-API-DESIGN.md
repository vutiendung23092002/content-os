# API DESIGN

## 1. Nguyên tắc

- API nội bộ, server-only đối với mọi lệnh gọi Meta và AI.
- Route handler mỏng; business rule nằm trong service/use-case.
- Validate input/output bằng schema.
- Timestamp truyền dạng ISO 8601 có timezone, lưu UTC.
- Mutation tạo remote object có operation record trước khi gọi Meta.
- Không trả token, ciphertext hoặc raw secret trong bất kỳ response nào.

Response lỗi chuẩn:

```json
{
  "error": {
    "code": "FACEBOOK_PERMISSION_DENIED",
    "message": "Page token không còn quyền quản lý bài viết.",
    "requestId": "req_...",
    "retryable": false
  }
}
```

## 2. Facebook connection và Page

| Method   | Route                                | Mục đích                                        |
| -------- | ------------------------------------ | ----------------------------------------------- |
| `GET`    | `/api/facebook/status`               | Kiểm tra connection đã cấu hình, không lộ token |
| `POST`   | `/api/facebook/sync-pages`           | Gọi Page discovery và cập nhật Page/Page token  |
| `POST`   | `/api/facebook/pages/check`          | Tài khoản đã duyệt kiểm tra Page ID/quyền đọc   |
| `POST`   | `/api/facebook/pages`                | Tài khoản đã duyệt thêm Page vào danh mục       |
| `GET`    | `/api/pages`                         | Liệt kê Page đang quản lý                       |
| `PATCH`  | `/api/pages/:pageId`                 | Bật/tắt Page và cập nhật cấu hình hiển thị      |
| `DELETE` | `/api/pages/:pageId`                 | Admin gỡ Page khỏi ứng dụng                     |
| `POST`   | `/api/pages/:pageId/refresh`         | Đồng bộ published và scheduled posts            |
| `GET`    | `/api/pages/:pageId/posts/published` | Danh sách bài remote đã đăng                    |
| `GET`    | `/api/pages/:pageId/posts/scheduled` | Danh sách bài remote đang được Facebook hẹn giờ |

`sync-pages` chỉ dùng user access token từ secret manager. Client không gửi token trong body.

`GET /api/pages` trả cả Page được cấp và chưa được cấp cùng `canAccess`; Page chưa được cấp chỉ phục vụ trạng thái khóa trên UI. Mọi API nhận `pageId`/`postId` vẫn kiểm tra assignment ở server.

Thêm Page vào danh mục không đồng nghĩa tự cấp quyền cho người thêm. `DELETE /api/pages/:pageId` là soft-delete nội bộ: đặt Page inactive và thu hồi assignment trong cùng transaction; không gọi API xóa Page/bài viết của Facebook. Page inactive bị chặn với cả Super Admin và không xuất hiện trong selector/danh sách ứng dụng.

## 2.1. Quản trị nhân sự và Page

| Method | Route                            | Mục đích                             |
| ------ | -------------------------------- | ------------------------------------ |
| `GET`  | `/api/admin/users`               | Danh sách user và số Page được cấp   |
| `GET`  | `/api/admin/users/:userId/pages` | Mở dữ liệu phân quyền Page           |
| `PUT`  | `/api/admin/users/:userId/pages` | Thay phạm vi Page được phép của user |

Mutation yêu cầu same-origin. Super Admin cấp mọi Page; Admin chỉ cấp Page thuộc phạm vi của mình và không quản lý Admin khác.

## 3. Draft và publish

| Method   | Route                           | Mục đích                                       |
| -------- | ------------------------------- | ---------------------------------------------- |
| `GET`    | `/api/posts`                    | Lọc draft/local mirror theo Page và trạng thái |
| `POST`   | `/api/posts`                    | Tạo draft                                      |
| `GET`    | `/api/posts/:postId`            | Xem draft và remote mapping                    |
| `PATCH`  | `/api/posts/:postId`            | Sửa draft khi chưa submit                      |
| `DELETE` | `/api/posts/:postId`            | Xóa draft chưa có remote object                |
| `POST`   | `/api/posts/:postId/publish`    | Đăng ngay qua Meta                             |
| `POST`   | `/api/posts/:postId/schedule`   | Tạo lịch native trên Facebook                  |
| `PATCH`  | `/api/posts/:postId/reschedule` | Đổi thời gian của remote scheduled post        |
| `PATCH`  | `/api/posts/:postId/message`    | Sửa caption của bài remote đã hẹn/đã đăng      |
| `DELETE` | `/api/posts/:postId/remote`     | Hủy lịch hoặc xóa bài remote đã đăng           |

Ví dụ schedule request:

```json
{
  "scheduledFor": "2026-08-21T09:00:00+07:00"
}
```

Backend chuyển về UTC, kiểm tra capability/range đã xác nhận và gửi `published=false` cùng `scheduled_publish_time` tới endpoint Meta phù hợp. Response thành công chỉ được trả sau khi remote ID đã được lưu hoặc operation được đánh dấu rõ là cần reconciliation.

Các mutation lên remote post đều tạo operation trước khi gọi Meta, kiểm tra same-origin và quyền Page hiện tại. Local mirror chỉ được cập nhật/tombstone sau khi Meta xác nhận; lỗi timeout/retryable hoặc lỗi local persistence sau remote success được đưa vào ledger để đối soát, không retry mù.

## 4. Asset

| Method   | Route                      | Mục đích                                       |
| -------- | -------------------------- | ---------------------------------------------- |
| `POST`   | `/api/assets`              | Validate và upload một ảnh vào private Storage |
| `POST`   | `/api/assets/video-upload` | Tạo signed upload và xác nhận video đã tải     |
| `DELETE` | `/api/assets/:assetId`     | Xóa asset chưa được gắn vào draft              |

Các route này chỉ xuất hiện sau khi text post ổn định.

## 5. AI content

| Method | Route              | Mục đích                  |
| ------ | ------------------ | ------------------------- |
| `POST` | `/api/ai/captions` | Tạo các phương án caption |
| `POST` | `/api/ai/rewrite`  | Viết lại caption hiện tại |
| `POST` | `/api/ai/ideas`    | Gợi ý ý tưởng nội dung    |

AI response không tự cập nhật post. Client phải gọi `PATCH /api/posts/:postId` sau khi người vận hành chọn kết quả.

## 6. Cron và reconciliation

| Method  | Route                                             | Mục đích                                                 |
| ------- | ------------------------------------------------- | -------------------------------------------------------- |
| `GET`   | `/api/facebook/operations/reconciliation`         | Admin liệt kê operation cần đối soát                     |
| `POST`  | `/api/facebook/operations/:operationId/reconcile` | Đọc remote evidence và tự chốt khi có đúng một candidate |
| `PATCH` | `/api/facebook/operations/:operationId/reconcile` | Admin giải quyết thủ công từ evidence đã được xác minh   |
| `POST`  | `/api/cron/sync-facebook`                         | Đồng bộ Page theo batch có cursor                        |
| `POST`  | `/api/cron/reconcile-operations`                  | Đối soát định kỳ operation bất định                      |

Ba route operation yêu cầu Admin; mutation kiểm tra same-origin. Không route nào retry request create. Hai cron endpoint dùng `Authorization: Bearer <FACEBOOK_CRON_SECRET>`, lease database để tránh chạy chồng và retry hữu hạn. Cron không đăng bài đến hạn; Facebook thực hiện việc đó.

## 7. Idempotency và lỗi không chắc chắn

- Mutation nội bộ nhận `Idempotency-Key` hoặc tạo operation key ổn định.
- Retry cùng key trả lại operation hiện có nếu kết quả đã biết.
- Timeout từ Meta chuyển operation sang `uncertain`, không tự tạo request đăng lần hai.
- Permission/token error là non-retryable cho đến khi credential được sửa.
- Rate limit hoặc lỗi 5xx có retry hữu hạn với jitter nếu thao tác an toàn để retry.

## 8. Phân trang và cache

- Danh sách remote giữ cursor Meta ở server; client nhận cursor opaque của ứng dụng.
- Không để Graph cursor chứa dữ liệu nhạy cảm trong log.
- Cache danh sách Page ngắn hạn; mutation luôn invalidate cache liên quan.
- Timeline gửi `weekStart`; backend giới hạn published posts bằng `since/until`, phân trang tối đa 100 bản ghi mỗi request và mirror kết quả vào `posts`.
- `POST /api/posts` nhận `assetIds` có thứ tự, tối đa 10 phần tử; mỗi asset phải thuộc đúng Page, chưa bị xóa và chưa gắn vào bài khác.
- Publish/schedule bài nhiều ảnh dùng signed URL ngắn hạn để Meta tạo unpublished photo, sau đó tạo một feed post bằng `attached_media`.
- Publish/schedule video dùng một signed URL ngắn hạn qua Page `/videos`; không dùng endpoint Reel.
- `sync_cursors` ghi nhận cửa sổ Page/kind/tuần đã đồng bộ, kể cả tuần không có bài, để tránh gọi Meta lặp lại.
- Cache tuần có TTL 5 phút. Dữ liệu cũ được trả ngay rồi client refresh nền; `refresh=1` buộc đồng bộ Meta.
- Client giữ cache theo `pageId + tab + view + weekStart`; đổi tab hoặc quay lại tuần vừa xem không gọi lại API trong TTL.
- Các request đồng bộ cùng Page/kind/tuần dùng chung một promise trên server để tránh gọi Meta trùng.
