# Facebook and Meta integration

## Integration model

Google OAuth qua Supabase vẫn là cơ chế đăng nhập Content OS duy nhất. Facebook có
hai Meta App và hai nguồn credential độc lập:

```text
Google session/approved app_user
        |
        +--> App A admin-managed
        |    FACEBOOK_APP_ID / FACEBOOK_APP_SECRET
        |    FACEBOOK_USER_ACCESS_TOKEN
        |    -> existing Pages and encrypted Page credentials
        |
        +--> App B user-connected OAuth
             FACEBOOK_CONNECT_APP_ID / FACEBOOK_CONNECT_APP_SECRET
             -> encrypted per-user token
             -> discovered/selected Pages
             -> encrypted Page credential linked to connection + assignment
```

App A tiếp tục phục vụ sync/manual admin hiện có. App B chỉ phục vụ onboarding của
từng approved user. Mỗi User/Page token đều được debug/inspect với App ID và App
secret tương ứng; token App A không được chấp nhận trong App B và ngược lại. Không
dùng token mua/chia sẻ từ bên thứ ba.

## App B OAuth và Page onboarding

1. `GET /api/facebook/connect` tạo 32 random bytes làm state, chỉ persist SHA-256
   hash cùng `app_user_id`, fixed callback intent và expiry 10 phút.
2. Browser được redirect đến versioned Meta OAuth dialog với scope tối thiểu của
   các chức năng hiện tại.
3. `GET /api/facebook/callback` yêu cầu lại approved Google viewer, atomic-consume
   state, đổi code và long-lived user token hoàn toàn server-side.
4. Backend gọi `/me` và debug token để xác nhận token valid, `app_id` là App B và
   `user_id` khớp account vừa đọc.
5. User token được mã hóa bằng keyring hiện có; browser chỉ nhận safe account,
   scope và expiry metadata.
6. Page discovery phân trang có giới hạn và loại bỏ `access_token` trước response.
7. Khi user chọn Page, backend xác nhận connection thuộc chính viewer rồi tái dùng
   `verifyManualPage()` để kiểm tra Page ID/type/App B/capabilities và mã hóa Page
   token trước transaction persist.

Callback hợp lệ duy nhất là `${NEXT_PUBLIC_SITE_URL}/api/facebook/callback` (hoặc
explicit URI cùng origin/path, không query/hash). Callback cuối luôn redirect về
`/pages?facebook=...`; authorization code, state và token không được đặt vào URL đó.

## Credential selection và disconnect

- Browser read/mutation truyền actor ID xuống credential repository. Repository ưu
  tiên active App B credential của actor, sau đó mới fallback App A
  admin-managed/legacy; App B credential của user khác không bao giờ được chọn.
- Cron/machine flow không có actor chỉ được dùng App A
  admin-managed/legacy; không bao giờ fallback sang bất kỳ App B credential nào.
- Background sync bỏ qua Page không có App A usable, checkpoint Page đó và tiếp tục
  Page sau. Chỉ credential-ineligibility được skip; lỗi Graph tạm thời vẫn giữ fail/retry
  hiện có. Việc skip không load credential hoặc tạo Meta client từ App B.
- Disconnect giữ connection/Page/history, đánh dấu connection `revoked`, revoke chỉ
  Page credentials cùng `facebook_connection_id` và xóa chỉ auto-assignment do
  connection đó tạo. Không gọi delete Facebook, không đụng App A/user khác.
- Reconnect cùng Facebook user refresh token/scope/expiry trên cùng connection ID
  và giữ nguyên Page credential hiện có. Reconnect sang Facebook user khác
  revoke toàn bộ Page credential và xóa auto-assignment của connection cũ trong
  cùng transaction trước khi đổi identity; Page/history, manual assignment,
  App A và user khác được giữ nguyên.
- Credential incident chỉ vô hiệu hóa credential/connection bị lỗi. Legacy
  App A revocation chỉ update row có `facebook_connection_id is null`; App B row
  cùng Page không bị ảnh hưởng. Page chỉ bị global lock khi không còn
  credential usable nào, nhưng availability check này không được dùng để
  cấp App B credential cho cron.
- Disconnect hoặc đổi Facebook identity recompute health của từng Page bị ảnh hưởng
  trong cùng transaction: còn bất kỳ credential usable nào thì Page đang active được
  giữ active; hết credential thì Page chuyển `revoked`. Page/history và assignment
  manual/admin không bị xóa; verify/connect lại chỉ kích hoạt đúng Page đã verify.

## Reconciliation credential provenance

- Publish, schedule, update, cancel/delete và reschedule ghi `credential_source`,
  exact `page_credential_id`, nullable `facebook_connection_id` và actor trước khi gọi
  Meta. Operation không chứa token, ciphertext hoặc App secret.
- System reconciliation dùng App A-only. Với operation phát sinh từ App B, cron đưa
  về `needs_attention` với reason `actor_reconciliation_required` và không remote read.
- Admin đã authorize có thể khởi tạo manual reconciliation; backend vẫn load duy nhất
  exact credential/connection lưu trên operation. Credential đã revoke/mất không được
  thay bằng App A hay App B khác và kết quả giữ `needs_attention` an toàn.
- Operation legacy thiếu provenance giữ compatibility bằng App A-only; không đoán hoặc
  duyệt qua App B của bất kỳ user nào.

## Capability smoke test before implementation

Pin một Graph API version và test trên Page không quan trọng:

1. `GET /me/accounts` trả đúng Page và tasks.
2. Publish text now.
3. Create text scheduled post ít nhất 30 phút trong tương lai.
4. `GET /{page-id}/scheduled_posts` thấy remote ID/time.
5. Update message/reschedule.
6. Delete test scheduled post.
7. Sau khi text flow đã qua gate, repeat riêng với single image; bước này không chặn text MVP.

Ghi safe request/response shape và exact error codes; không ghi token.

## Permissions

Expected minimum candidates:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
```

Exact permissions, access tier, App Review, app mode và Business Verification phải được xác minh trong current App Dashboard/Graph API docs. Tool không tự request thêm comments/messages/ads/insights scopes.

## Publish now

Text:

```http
POST /{page-id}/feed
Authorization: Bearer {page-access-token}

message=...
```

Single image dự kiến dùng `/{page-id}/photos` với caption và controlled media input. Enable only after contract test.

## Facebook-native scheduling

Text scheduled post:

```http
POST /{page-id}/feed
Authorization: Bearer {page-access-token}

message=...
published=false
scheduled_publish_time={UTC timestamp/datetime accepted by pinned API version}
```

Success must return/store a remote post ID. The app then reads:

```http
GET /{page-id}/scheduled_posts
  ?fields=id,message,scheduled_publish_time,is_published,created_time
```

Meta SDK currently exposes `published`, `scheduled_publish_time`, Page `/scheduled_posts`, PagePost update and delete. Runtime behavior and scheduling window still require smoke test against the pinned version.

## Reschedule/edit/cancel

- Update scheduled PagePost using its remote ID and supported fields (`message`, `scheduled_publish_time`, `is_published`, media where supported).
- Cancel/delete uses the documented PagePost delete operation after confirmation.
- After every mutation, refetch remote scheduled record/list; do not trust local optimistic state alone.
- If Meta says the record no longer exists, reconcile whether it published or was deleted.

## Published and scheduled lists

### Scheduled

Remote-first from `/{page-id}/scheduled_posts`; local DB is cache/mapping. Show `lastSyncedAt` and remote error/staleness.

### Published

Fetch recent Page posts through the current documented edge/fields supported by the Page token. Upsert remote IDs, message, created/published time and safe media/permalink metadata. Do not fetch commenter/user data for MVP.

## Scheduling time

- UI accepts local time + IANA timezone.
- Server converts to UTC/Unix timestamp.
- Reject past/ambiguous invalid time.
- Do not hardcode a Meta scheduling window until version smoke test; make min/max config from verified evidence.

## Timeout and duplicate prevention

Danger case:

```text
POST schedule -> Meta creates post -> response times out
```

Do not send the create request again immediately. Mark operation `uncertain`, fetch scheduled posts for the relevant Page/time/request fingerprint, and ask for manual resolution if no exact evidence. Native scheduling removes the due-time publish retry problem but not create-request ambiguity.

## Token health

- Validate at startup/config check and before write when stale.
- Normalize expired/revoked/missing permission/rate-limit errors.
- Mark Page degraded and block mutations when token is invalid.
- Replacing User token must resync and atomically rotate each Page credential.
- Never include credential in query logs, provider summaries, AI context or browser responses.

## Compliance rules

- Official Graph API only; no scraping/Selenium/cookies/private endpoints.
- Only Pages returned by authorized token.
- Respect rate limits, permissions, app mode/review and Meta content policies.
- Human explicitly triggers publish/schedule; AI output is not autonomously posted.
- Retain only Page/post data needed by the tool and provide local cleanup.

## External references

- Meta Facebook Login documentation: <https://developers.facebook.com/docs/facebook-login/>
- Access tokens and debugging: <https://developers.facebook.com/docs/facebook-login/guides/access-tokens/>
- Pages API getting started: <https://developers.facebook.com/docs/pages-api/getting-started/>
- Pages API posts: <https://developers.facebook.com/docs/pages-api/posts/>
- Graph API Page feed: <https://developers.facebook.com/docs/graph-api/reference/page/feed/>
- Meta official SDK Page model: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py>
- Meta official SDK PagePost: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/pagepost.py>
- Meta Platform/Commercial Terms: <https://www.facebook.com/legal/terms>

## Deferred

Webhooks, system user migration, Instagram, analytics insights, Reel và bulk
multi-Page publishing. Video thường của Page đã có adapter riêng qua `/videos`.

Meta App B production use cho external users phụ thuộc App mode, Business
Verification, Advanced Access/App Review và permission approval thực tế trong Meta
Dashboard. Repository không coi unit test là bằng chứng những approval này đã có.
