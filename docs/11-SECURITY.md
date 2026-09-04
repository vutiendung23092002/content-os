# SECURITY AND META COMPLIANCE

## 1. Mô hình sử dụng

Đây là công cụ nội bộ cho một nhóm nhỏ. Google/Supabase là login duy nhất;
Facebook chỉ là integration sau đăng nhập. App A dùng token admin-managed phía
server. App B cho phép từng approved user OAuth tài khoản Facebook riêng nhưng
không trả raw token cho browser.

"Không có đăng nhập phức tạp" không đồng nghĩa ứng dụng được public. Production phải nằm sau ít nhất một lớp bảo vệ như Cloudflare Access, VPN, private network hoặc một admin secret/session đơn giản.

Public hostname dùng Supabase Google OAuth. Email phải có trạng thái `approved` trong allowlist; UI và API đều fail closed. `INITIAL_ADMIN_EMAIL` là Super Admin đầu tiên và có thể bổ nhiệm thêm Admin. `APP_ACCESS_SECRET` không phải mật khẩu nhân sự, chỉ là credential server-to-server tùy chọn. Không dùng Facebook token làm mật khẩu đăng nhập tool.

## 2. Nguyên tắc tuân thủ Meta

- Chỉ dùng Graph API và SDK/tài liệu chính thức của Meta.
- Không scraping Facebook, không Selenium, không cookie automation và không private endpoint.
- Chỉ thao tác các Page mà token thực sự có quyền.
- Chỉ yêu cầu quyền cần cho việc liệt kê Page, đọc bài và quản lý bài.
- Pin Graph API version và chạy capability smoke test trước khi phát hành.
- Tôn trọng rate limit, lỗi permission, checkpoint và quyết định của Meta.
- Không dùng AI để tạo tương tác giả, spam hoặc né cơ chế kiểm duyệt.

Quyền dự kiến gồm `pages_show_list`, `pages_read_engagement` và `pages_manage_posts`, nhưng phải xác nhận lại trên app/token và version thực tế. Không coi danh sách này là bảo đảm App Review hoặc Business Verification được miễn.

## 3. Quản lý token

### User access token

- App A được nhập thủ công qua biến môi trường/secret manager phía server.
- App B đổi authorization code ở server, inspect đúng App ID/Facebook user rồi lưu
  AES-256-GCM trong `facebook_connection`; raw state không được persist và hash
  one-time state hết hạn sau 10 phút.
- Không gửi xuống browser và không lưu trong localStorage.
- Không commit vào Git, paste vào issue hoặc đưa vào prompt AI.
- Không in URL Graph API có query parameter chứa token.

### Page access token

- Lấy server-side từ luồng Page discovery chính thức.
- Mã hóa ở tầng ứng dụng trước khi lưu database.
- Khóa mã hóa nằm trong secret manager, tách khỏi database.
- Chỉ giải mã ngay trước khi gọi Meta.
- Khi rotate khóa, hỗ trợ versioned ciphertext.

Không log token, kể cả token đã cắt ngắn. Hash/fingerprint một chiều chỉ dùng khi thật sự cần đối chiếu.

Khi rotate encryption key, transaction xoay cả Page credentials và App B encrypted
user tokens; operator chỉ bỏ previous key sau khi cả hai remaining counts bằng 0.
Rotation không tự mở lại connection bị khóa do auth/permission incident.

## 4. Kiểm soát truy cập ứng dụng

Ưu tiên theo môi trường:

- local: chỉ bind localhost;
- staging: access gateway hoặc VPN;
- production: access gateway + allowlist nếu khả thi;
- cron: secret riêng và kiểm tra signature/header;
- database/object storage: private network hoặc credential giới hạn quyền.

Các mutation publish/schedule/cancel phải có CSRF protection hoặc same-site session phù hợp và rate limit, kể cả chỉ có một operator.

Mutation chọn Page/ngắt App B yêu cầu same-origin, approved viewer, actor rate limit
và ownership check lại trong service/repository. Disconnect chỉ tác động record có
cùng `facebook_connection_id`; không xóa remote content hoặc credential của user/App
khác.

Credential lookup tách hai API: actor ưu tiên App B của chính mình rồi App A;
system/cron chỉ App A. Incident revoke theo credential/connection cụ thể, và
legacy App A chỉ update row null-provenance. Page global lock chỉ xảy ra sau khi
không còn credential usable khác.

Disconnect và đổi Facebook identity recompute Page health trong cùng transaction.
Availability của App B có thể giữ Page global active cho đúng actor, nhưng không bao
giờ mở quyền system/cron dùng App B. Mọi Facebook mutation mới ghi exact credential
provenance trước remote call; cron chỉ reconcile App A. Operation App B cần authorized
manual reconciliation bằng đúng stored credential/connection, không credential fallback.

## 5. Bảo vệ request và dữ liệu

- Validate tất cả body, path parameter và timestamp.
- Chuẩn hóa timezone; lưu UTC và hiển thị timezone được chọn.
- Dùng prepared query/ORM, không ghép SQL từ input.
- Chỉ chấp nhận media type/kích thước đã cho phép.
- Giới hạn độ dài caption và số request AI.
- Error trả client không chứa raw Graph response nếu có nguy cơ lộ dữ liệu.
- Backup database đã mã hóa và kiểm tra restore định kỳ.

## 6. Rủi ro đặc thù publish

### Timeout không rõ kết quả

Meta có thể đã tạo bài dù client nhận timeout. Hệ thống phải ghi operation là `uncertain`, đối soát remote rồi mới cho retry. Không blind retry mutation tạo bài.

### Database lỗi sau Meta thành công

Ghi operation intent và credential provenance trước khi gọi Meta. Nếu lưu remote ID thất bại, reconciliation dùng Page, loại thao tác, thời gian và fingerprint nội dung với đúng credential policy để tìm kết quả; người vận hành được cảnh báo thay vì tự đăng lại. Operation legacy chỉ dùng App A; operation App B không được cron đoán credential.

### Token hết hạn hoặc mất quyền

Dừng mutation cho Page liên quan, hiển thị lỗi có hành động khắc phục và không retry vô hạn. Không cố vượt checkpoint hoặc permission error.

## 7. AI và dữ liệu bên thứ ba

- Loại token, secret và metadata không cần thiết khỏi prompt.
- Công khai provider đang dùng và cấu hình lưu dữ liệu của provider.
- Không gửi toàn bộ lịch sử Page nếu tác vụ chỉ cần một draft.
- Người vận hành duyệt đầu ra trước khi đăng.

## 8. Checklist trước production

- Token không xuất hiện trong bundle client, log, error tracking hoặc AI history.
- App được bảo vệ khỏi truy cập công khai.
- Capability smoke test chạy thành công với Page test.
- Publish, schedule, reschedule và cancel được kiểm tra trên Graph version đã pin.
- Có cảnh báo token/permission failure.
- Có quy trình rotate/revoke token và khóa mã hóa.
- Có reconciliation cho mutation `uncertain`.
- Đã rà điều khoản Meta và yêu cầu App Review/Business Verification áp dụng cho app thực tế.
