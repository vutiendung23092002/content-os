# Access protection

## Scope decision

MVP là single-operator. Không xây users, teams, roles, invites hoặc Facebook OAuth login.

Tuy nhiên ứng dụng không được public không bảo vệ vì backend có khả năng đăng bài bằng Page token.

## Allowed deployment modes

Chọn đúng một mode:

1. **Local-only:** bind localhost, phù hợp tool cá nhân.
2. **Private network/VPN:** chỉ thiết bị nội bộ truy cập.
3. **Access gateway:** Cloudflare Access, Vercel protection hoặc reverse-proxy authentication.
4. **Single admin secret:** signed `HttpOnly` session sau khi nhập một mật khẩu dài; chỉ dùng nếu gateway không khả dụng.

Khuyến nghị production: access gateway. Không dùng Facebook token làm mật khẩu đăng nhập tool.

## Server checks

- Mọi `/api/*` route trừ health nội bộ phải qua access guard.
- Cron endpoint dùng dedicated secret/signature và không dùng browser session.
- CSRF protection áp dụng cho mutation nếu dùng cookie session.
- Rate limit các action publish/schedule/update/delete/AI.
- UI confirmation bắt buộc cho publish now và cancel/delete remote post.

## Facebook authorization

Facebook authorization không được quyết định bởi UI user roles. Backend chỉ thao tác Page đã sync từ `/me/accounts`, có encrypted Page token và capability phù hợp.

```text
private operator access
AND configured Meta App/User token
AND Page returned/validated by Meta
AND required Page task/scope
= operation allowed
```

## Token configuration

Default MVP:

- User Access Token nằm trong hosting secret `FACEBOOK_USER_ACCESS_TOKEN`.
- Page tokens lấy từ sync và được mã hóa vào `page_credentials`.
- Token rotation: cập nhật hosting secret, chạy Validate + Sync Pages, thay Page credentials sau khi xác minh.

Nếu sau này có Settings UI để nhập token, route phải sau access gateway, HTTPS, không echo token, không log body và mã hóa trước khi persist.

## Tests

- Public/unauthenticated request không gọi service Meta.
- Cron secret sai bị từ chối.
- CSRF/replay với mutation cookie mode.
- Token không xuất hiện trong HTML, JSON, localStorage, logs hoặc error reporting.
- Page ID giả không lấy được credential.
