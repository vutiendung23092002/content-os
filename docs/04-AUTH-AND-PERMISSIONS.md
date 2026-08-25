# Authentication and permissions

## Hai lớp danh tính tách biệt

- Google OAuth qua Supabase Auth xác định ai đang dùng HanContent.
- Facebook User/Page token cố định ở server xác định Page nào backend có thể đọc hoặc quản lý.

Đăng nhập Google không cấp thêm quyền Facebook. Nhân sự không nhìn thấy và không cần nhập `FACEBOOK_USER_ACCESS_TOKEN`, Page token hoặc `APP_ACCESS_SECRET`.

## Luồng đăng nhập

1. Người dùng chọn **Tiếp tục với Google**.
2. Supabase chạy OAuth PKCE và trả về `/auth/callback`.
3. Callback lấy user đã được Supabase xác minh, chuẩn hóa email và upsert `hancontent_os.app_users`.
4. Email trùng `INITIAL_ADMIN_EMAIL` trở thành Super Admin đã duyệt.
5. Email đã có trong allowlist được vào tool; email mới ở trạng thái `pending` và chỉ thấy màn chờ duyệt.
6. Mỗi API đọc lại vai trò/trạng thái từ database. Tạm khóa có hiệu lực mà không cần chờ cookie hết hạn.

## Vai trò

- `super_admin`: chủ hệ thống bootstrap; duyệt user, thêm email và bổ nhiệm/hạ quyền Admin.
- `admin`: thêm/duyệt/tạm khóa nhân viên; không thay đổi Super Admin hoặc Admin khác.
- `member`: sử dụng chức năng nội dung/Page đã được hệ thống cho phép.

## Phân quyền Page

- Super Admin sử dụng toàn bộ Page active trong hệ thống.
- Admin và nhân viên chỉ xem nội dung, tạo/sửa/xóa draft, đăng hoặc hẹn giờ trên Page được gán trong `user_page_assignments`.
- Admin chỉ được gán cho nhân viên những Page chính Admin đó đang được quản lý; Super Admin có thể gán mọi Page.
- Danh sách chọn Page vẫn hiển thị Page chưa được cấp ở trạng thái mờ, khóa và không thể chọn.
- Backend kiểm tra lại `page_id` hoặc Page của `post_id` tại từng API. Ẩn/khóa trên UI không phải lớp bảo mật.
- Thu hồi assignment có hiệu lực ở request tiếp theo. Facebook token dùng chung ở server không làm phát sinh quyền ứng dụng cho người dùng.

Trạng thái gồm `pending`, `approved`, `rejected`, `suspended`. Chỉ `approved` được gọi API nghiệp vụ.

## Cấu hình Supabase và Google

Trong ứng dụng:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
NEXT_PUBLIC_SITE_URL=https://social.example.com
INITIAL_ADMIN_EMAIL=<email-chủ-hệ-thống>
```

Trong Google Cloud Console, Authorized redirect URI của OAuth client là callback do Supabase cung cấp:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Trong Supabase Dashboard:

- Auth > Providers > Google: bật provider và nhập Google Client ID/Secret.
- Auth > URL Configuration > Site URL: `https://social.example.com`.
- Redirect URLs: thêm `https://social.example.com/auth/callback` và URL callback local tương ứng khi phát triển.

## Kiểm soát server

- Proxy chỉ làm redirect trải nghiệm; từng API vẫn tự xác minh Supabase user và allowlist.
- Mutation quản trị yêu cầu cùng origin để giảm CSRF.
- API nghiệp vụ chấp nhận Google session đã duyệt hoặc `x-han-access-secret` đúng cho automation server-to-server.
- Cron tương lai phải có credential riêng, không dùng browser session.
- Publish/schedule/update/delete vẫn phải qua Page capability và confirmation riêng; quyền Google không tự tạo quyền Facebook.

## Kiểm thử bắt buộc

- User chưa đăng nhập bị đưa về `/login`; API trả 401.
- User pending/rejected/suspended không gọi được service Meta.
- Admin không thể sửa Super Admin hoặc Admin khác.
- User không thể đọc hoặc thao tác Page chưa được gán bằng cách gọi API trực tiếp.
- Admin không thể cấp một Page nằm ngoài phạm vi của chính mình.
- Member không vào được `/admin` và admin API.
- Token/secret không xuất hiện trong HTML, JSON, client bundle, logs hoặc localStorage.
- Không gọi API ghi Facebook khi chưa có Page test do người vận hành chỉ định.
