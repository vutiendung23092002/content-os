# IMAGE SUPPORT

## 1. Quyết định phạm vi

AI tạo ảnh chưa nằm trong giai đoạn hiện tại. Phạm vi đã mở rộng sang đăng tối đa 10 ảnh do người vận hành tải lên, sắp xếp thứ tự, đăng ngay hoặc lên lịch native của Facebook.

Việc trì hoãn giúp giảm đồng thời rủi ro bản quyền, chi phí, thời gian xử lý file và độ phức tạp của luồng publish.

## 2. Hỗ trợ ảnh trong composer

Luồng hiện tại hỗ trợ:

- tải lên tối đa 10 ảnh JPEG/PNG/WebP;
- kiểm tra MIME type, kích thước và dung lượng;
- lưu object storage riêng tư;
- preview bố cục, xóa và thay đổi thứ tự trước khi đăng;
- đăng ngay hoặc lên lịch bằng endpoint chính thức phù hợp của Meta;
- lưu remote media/post ID để đối soát.

Facebook quyết định bố cục album cuối cùng. Công cụ giữ thứ tự `attached_media` nhưng không cam kết ép một layout cụ thể. Chưa hỗ trợ video, reel, chỉnh sửa ảnh hay thư viện template trong giai đoạn này.

## 3. Luồng xử lý an toàn

1. Backend cấp signed upload URL ngắn hạn.
2. Client upload trực tiếp vào object storage.
3. Backend kiểm tra metadata và trạng thái object.
4. Asset được gắn với một draft qua `post_assets`, kèm `sort_order`.
5. Khi submit, Meta adapter upload từng ảnh với `published=false`, sau đó tạo một feed post chứa `attached_media` theo đúng thứ tự.
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

## 5. Tiêu chí xác minh trước khi dùng thật

Không bật dùng thật trên Page vận hành trước khi các test sau đã ổn định:

- publish text now;
- native scheduled text post;
- remote scheduled/published sync;
- reschedule và cancel;
- reconciliation khi timeout hoặc database ghi thất bại.
