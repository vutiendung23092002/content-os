# IMAGE SUPPORT

## 1. Quyết định phạm vi

AI tạo ảnh không nằm trong MVP đầu tiên. Ưu tiên hoàn thiện đăng text, đăng một ảnh do người vận hành tải lên, lên lịch native của Facebook và đồng bộ danh sách bài.

Việc trì hoãn giúp giảm đồng thời rủi ro bản quyền, chi phí, thời gian xử lý file và độ phức tạp của luồng publish.

## 2. Hỗ trợ ảnh trong MVP

Nếu triển khai sau luồng text, MVP chỉ cần:

- tải lên một ảnh JPEG/PNG/WebP;
- kiểm tra MIME type, kích thước và dung lượng;
- lưu object storage riêng tư;
- preview trước khi đăng;
- đăng ngay hoặc lên lịch bằng endpoint chính thức phù hợp của Meta;
- lưu remote media/post ID để đối soát.

Không hỗ trợ carousel, video, reel, chỉnh sửa ảnh hay thư viện template trong giai đoạn này.

## 3. Luồng xử lý an toàn

1. Backend cấp signed upload URL ngắn hạn.
2. Client upload trực tiếp vào object storage.
3. Backend kiểm tra metadata và trạng thái object.
4. Asset được gắn với một draft.
5. Khi submit, Meta adapter chọn đúng publish flow cho text hoặc single image.
6. Chỉ xóa asset tạm khi chắc chắn không còn draft hoặc remote operation tham chiếu.

Object storage không được public mặc định. URL dùng để Meta tải media phải có thời hạn đủ cho request hiện tại và không chứa Facebook token.

## 4. AI tạo ảnh trong tương lai

Chỉ bổ sung khi chức năng lõi đã ổn định. Khi đó cần:

- hiển thị rõ ảnh do AI tạo;
- lưu provider, model, prompt, seed hoặc generation ID nếu có;
- kiểm soát chi phí và số lần tạo;
- có cơ chế từ chối prompt rủi ro;
- yêu cầu người vận hành duyệt trước khi gắn vào draft;
- xem xét điều khoản thương mại, quyền sử dụng và chính sách của provider.

AI không được tự tạo ảnh rồi tự đăng.

## 5. Tiêu chí mở rộng

Chỉ bắt đầu single-image support sau khi các test sau đã ổn định:

- publish text now;
- native scheduled text post;
- remote scheduled/published sync;
- reschedule và cancel;
- reconciliation khi timeout hoặc database ghi thất bại.
