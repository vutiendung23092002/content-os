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

| Method  | Route                                | Mục đích                                        |
| ------- | ------------------------------------ | ----------------------------------------------- |
| `GET`   | `/api/facebook/status`               | Kiểm tra connection đã cấu hình, không lộ token |
| `POST`  | `/api/facebook/sync-pages`           | Gọi Page discovery và cập nhật Page/Page token  |
| `GET`   | `/api/pages`                         | Liệt kê Page đang quản lý                       |
| `PATCH` | `/api/pages/:pageId`                 | Bật/tắt Page và cập nhật cấu hình hiển thị      |
| `POST`  | `/api/pages/:pageId/refresh`         | Đồng bộ published và scheduled posts            |
| `GET`   | `/api/pages/:pageId/posts/published` | Danh sách bài remote đã đăng                    |
| `GET`   | `/api/pages/:pageId/posts/scheduled` | Danh sách bài remote đang được Facebook hẹn giờ |

`sync-pages` chỉ dùng user access token từ secret manager. Client không gửi token trong body.

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
| `POST`   | `/api/posts/:postId/reschedule` | Đổi thời gian của remote scheduled post        |
| `POST`   | `/api/posts/:postId/cancel`     | Hủy/xóa remote scheduled post                  |

Ví dụ schedule request:

```json
{
  "scheduledFor": "2026-08-21T09:00:00+07:00"
}
```

Backend chuyển về UTC, kiểm tra capability/range đã xác nhận và gửi `published=false` cùng `scheduled_publish_time` tới endpoint Meta phù hợp. Response thành công chỉ được trả sau khi remote ID đã được lưu hoặc operation được đánh dấu rõ là cần reconciliation.

## 4. Asset

| Method   | Route                           | Mục đích                    |
| -------- | ------------------------------- | --------------------------- |
| `POST`   | `/api/assets/upload-intent`     | Cấp signed URL cho một ảnh  |
| `POST`   | `/api/assets/:assetId/complete` | Xác nhận upload và metadata |
| `DELETE` | `/api/assets/:assetId`          | Xóa asset chưa được dùng    |

Các route này chỉ xuất hiện sau khi text post ổn định.

## 5. AI content

| Method | Route              | Mục đích                  |
| ------ | ------------------ | ------------------------- |
| `POST` | `/api/ai/captions` | Tạo các phương án caption |
| `POST` | `/api/ai/rewrite`  | Viết lại caption hiện tại |
| `POST` | `/api/ai/ideas`    | Gợi ý ý tưởng nội dung    |

AI response không tự cập nhật post. Client phải gọi `PATCH /api/posts/:postId` sau khi người vận hành chọn kết quả.

## 6. Cron và reconciliation

| Method | Route                            | Mục đích                          |
| ------ | -------------------------------- | --------------------------------- |
| `POST` | `/api/cron/sync-facebook`        | Đồng bộ Page theo batch có cursor |
| `POST` | `/api/cron/reconcile-operations` | Đối soát operation `uncertain`    |

Cron endpoint dùng secret riêng, rate limit và lock để tránh chạy chồng. Cron không đăng bài đến hạn; Facebook thực hiện việc đó.

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
- UI luôn hiển thị `lastSyncedAt` để người vận hành biết độ mới của mirror.
