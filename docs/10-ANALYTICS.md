# POSTS LIST AND ANALYTICS SCOPE

## 1. Mục tiêu MVP

MVP cần hai màn hình vận hành, không phải một hệ thống analytics đầy đủ:

- danh sách bài đã đăng của từng Page;
- danh sách bài đang được Facebook hẹn giờ đăng.

Facebook là nguồn sự thật cho trạng thái remote. PostgreSQL giữ mirror tối thiểu để liên kết draft, hỗ trợ tìm kiếm và đối soát.

## 2. Danh sách bài đã đăng

Mỗi hàng nên hiển thị khi dữ liệu API cho phép:

- Page;
- remote post ID;
- đoạn đầu caption;
- loại media;
- thời điểm đăng;
- permalink;
- trạng thái đồng bộ gần nhất.

Màn hình phải phân biệt bài do tool tạo và bài được tạo trực tiếp trên Facebook. Không giả định mọi bài remote đều có draft nội bộ.

## 3. Danh sách bài hẹn giờ

Dữ liệu ưu tiên lấy từ endpoint scheduled posts chính thức của Page. Mỗi hàng hiển thị:

- remote post ID;
- caption preview;
- thời gian Facebook dự kiến đăng theo timezone rõ ràng;
- trạng thái remote;
- lần đồng bộ cuối;
- thao tác sửa lịch hoặc hủy nếu API/version hiện tại hỗ trợ và capability test đã qua.

Không chỉ lọc bảng `posts` theo trạng thái `scheduled`, vì người vận hành có thể sửa hoặc xóa lịch trực tiếp trong Meta Business Suite.

## 4. Đồng bộ

- Đồng bộ khi người vận hành mở màn hình hoặc bấm refresh.
- Cron định kỳ đồng bộ các Page đang hoạt động.
- Upsert theo `page_id + remote_post_id`.
- Đánh dấu `missing_remote` sau nhiều lần không thấy, không xóa ngay dữ liệu cục bộ.
- Sau thời điểm dự kiến đăng, kiểm tra lại scheduled list và published feed để xác định kết quả.

Nếu API timeout, giữ dữ liệu gần nhất và hiển thị `last synced at`; không biến lỗi đồng bộ thành kết luận rằng bài đã bị xóa.

## 5. Metrics ngoài MVP

Reach, impressions, reactions, comments, shares, click và biểu đồ xu hướng được hoãn lại. Khi cần analytics thật sự, phải xác nhận:

- metric nào còn tồn tại ở Graph API version đang pin;
- quyền và access level cần thiết;
- khoảng thời gian dữ liệu;
- nghĩa chính xác của từng metric;
- chính sách lưu và xóa dữ liệu.

Không hiển thị số 0 khi dữ liệu không có quyền truy cập; dùng `unavailable` hoặc `not synced`.

## 6. Tiêu chí hoàn thành MVP

- Có danh sách published và scheduled theo từng Page.
- Refresh lấy trạng thái từ Meta, có loading/error/last-sync rõ ràng.
- Bài tạo ngoài tool vẫn xuất hiện nếu API trả về.
- Lịch sửa trực tiếp trên Facebook được phản ánh sau đồng bộ.
- Không có dashboard vanity metrics chưa được kiểm chứng.
