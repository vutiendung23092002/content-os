# Facebook and Meta integration

## Integration model

Tool dùng Meta App của operator và server-side User Access Token. Không có OAuth UI trong MVP.

```text
FACEBOOK_USER_ACCESS_TOKEN
-> GET /me/accounts?fields=id,name,access_token,tasks
-> selected Pages
-> encrypt Page Access Tokens
-> use the correct Page token for Graph API calls
```

Token phải được tạo cho đúng Meta App, đúng Facebook account có Page access và đúng permissions. Không dùng token mua/chia sẻ từ bên thứ ba.

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

- Pages API posts: <https://developers.facebook.com/docs/pages-api/posts/>
- Graph API Page feed: <https://developers.facebook.com/docs/graph-api/reference/page/feed/>
- Meta official SDK Page model: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py>
- Meta official SDK PagePost: <https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/pagepost.py>
- Meta Platform/Commercial Terms: <https://www.facebook.com/legal/terms>

## Deferred

OAuth/reconnect UI, webhooks, system user migration, Instagram, analytics insights, Reel và bulk multi-Page publishing. Video thường của Page đã có adapter riêng qua `/videos`.
