# OBSERVABILITY

## 1. Mục tiêu

Observability phải trả lời nhanh bốn câu hỏi:

- Meta có nhận lệnh publish/schedule không?
- Facebook hiện coi bài là scheduled, published hay không còn tồn tại?
- Token/quyền nào đang gặp vấn đề mà không làm lộ credential?
- AI và sync đang tốn bao nhiêu thời gian, request và chi phí?

## 2. Structured logging

Mỗi log event dùng JSON và có các field phù hợp:

- `timestamp`, `level`, `event`;
- `requestId`, `operationId`;
- `pageId`, `postId`, `remotePostId`;
- `graphVersion`, `metaErrorCode`, `metaErrorSubcode`;
- `attempt`, `latencyMs`, `outcome`;
- `provider`, `model`, `usage` cho AI.

Tuyệt đối redact token, authorization header, cookie, signed URL, prompt nhạy cảm và raw response có thể chứa credential. Không log full caption mặc định; dùng post ID và content fingerprint.

## 3. Sự kiện quan trọng

- `facebook.pages_sync_started|succeeded|failed`
- `facebook.publish_submitted|succeeded|failed|uncertain`
- `facebook.schedule_submitted|succeeded|failed|uncertain`
- `facebook.reschedule_succeeded|failed`
- `facebook.cancel_succeeded|failed`
- `facebook.remote_sync_succeeded|failed`
- `facebook.operation_reconciled|needs_attention`
- `facebook.credential_invalid|permission_denied|rate_limited`
- `ai.generation_succeeded|failed|rate_limited`
- `cron.started|completed|skipped_locked|failed`

## 4. Metrics tối thiểu

- số publish/schedule theo outcome;
- số operation `uncertain` và tuổi của operation lâu nhất;
- tỷ lệ lỗi Graph API theo code/subcode;
- latency p50/p95 của Meta và AI;
- tuổi của lần sync thành công gần nhất theo Page;
- số scheduled post cục bộ không khớp remote;
- AI request, token usage và chi phí ước tính;
- cron duration, failure và lock contention.

Không dùng metrics nghiệp vụ như reach/impression nếu chưa triển khai analytics đúng nghĩa.

## 5. Cảnh báo

Cảnh báo cần hành động khi:

- credential invalid hoặc permission denied lặp lại;
- có operation `uncertain` quá ngưỡng;
- sync một Page thất bại liên tiếp;
- scheduled post sắp đến hạn nhưng không còn thấy remote;
- cron không chạy trong khoảng dự kiến;
- lỗi publish/schedule tăng đột biến;
- AI usage vượt budget cấu hình.

Cảnh báo không được chứa token hoặc full caption.

## 6. Audit trail nhẹ

Vì chỉ có một operator, MVP không cần hệ thống audit nhiều người dùng. Tuy vậy, `facebook_operations` phải lưu:

- thao tác và target;
- request fingerprint;
- trạng thái trước/sau;
- remote ID nếu có;
- timestamps;
- lỗi đã làm sạch;
- kết quả reconciliation.

Đây là dữ liệu quan trọng để tránh đăng trùng, không phải log tùy ý có thể xóa ngay.

## 7. Runbook tối thiểu

### Token mất hiệu lực

Tạm dừng mutation của Page, thay token trong secret manager, chạy sync-pages/capability test và chỉ mở lại sau khi test thành công.

### Schedule không xuất hiện

Tra operation ID, kiểm tra remote scheduled endpoint, kiểm tra timestamp/timezone và Meta error. Không tạo lịch thứ hai cho đến khi kết quả request cũ được xác định.

### App downtime tại giờ đăng

Kiểm tra remote published/scheduled lists. Với native scheduling, Facebook vẫn phải là bên thực hiện publish; app chỉ đồng bộ lại sau khi hoạt động.
