# Database design

## Principles

- Keep schema small; only add the minimal user/role/approval model needed for an internal allowlist.
- Store application tables and enums in PostgreSQL schema `hancontent_os`, not `public`.
- Meta remote IDs are first-class and unique per Page/platform.
- Meta is authority for scheduled/published state; DB stores drafts, mapping and last synchronized snapshot.
- Tokens are never plaintext columns.
- Timestamps use `timestamptz`; IDs use UUID.

## Enums

```text
connection_status: active, expired, revoked, permission_missing, error
post_status: draft, submitting, scheduled, published, failed, uncertain, needs_attention, canceled, deleted_remote
post_type: text, image, video
operation_type: sync_pages, publish_now, schedule, update, reschedule, cancel, sync_posts
operation_status: pending, succeeded, failed, uncertain, needs_attention
generation_type: caption, rewrite, idea
app_role: super_admin, admin, member
user_approval_status: pending, approved, rejected, suspended
facebook_connection_type: admin_managed, user_connected
```

## `app_users`

Allowlist người dùng Google. Supabase `auth.users` xác thực danh tính; bảng này là nguồn sự thật cho quyền trong ứng dụng.

| Field                          | Type                 |  Null | Constraint                                                            |
| ------------------------------ | -------------------- | ----: | --------------------------------------------------------------------- |
| `id`                           | uuid                 |    no | PK                                                                    |
| `external_user_id`             | text                 |   yes | unique Supabase user ID; null khi email được thêm trước lần login đầu |
| `email`                        | text                 |    no | normalized, unique                                                    |
| `name`, `avatar_url`           | text                 | mixed | profile hiển thị                                                      |
| `role`                         | app_role             |    no | default `member`                                                      |
| `approval_status`              | user_approval_status |    no | default `pending`                                                     |
| `approved_by_user_id`          | uuid                 |   yes | self FK, SET NULL                                                     |
| `approved_at`, `last_login_at` | timestamptz          |   yes | audit metadata                                                        |
| `is_bootstrap_super_admin`     | boolean              |    no | chỉ một row được true                                                 |
| timestamps                     | timestamptz          |    no |                                                                       |

## `facebook_connection`

Nguồn ủy quyền Meta. Row cũ và flow App A là `admin_managed` với
`app_user_id = null`; mỗi user Google có tối đa một row `user_connected` cho một
Meta App B. User token App B chỉ được lưu dưới dạng AES-256-GCM.

| Field                                                              | Type                     | Null | Constraint/meaning                       |
| ------------------------------------------------------------------ | ------------------------ | ---: | ---------------------------------------- |
| `id`                                                               | uuid                     |   no | PK                                       |
| `app_user_id`                                                      | uuid                     |  yes | FK app_users CASCADE; null cho App A     |
| `external_user_id`, `meta_app_id`                                  | text                     |  yes | Facebook user và Meta App tạo connection |
| `connection_type`                                                  | facebook_connection_type |   no | default `admin_managed`                  |
| `status`                                                           | connection_status        |   no | lock cục bộ cho connection               |
| `account_name`, `account_avatar_url`                               | text                     |  yes | safe profile metadata                    |
| `granted_scopes`                                                   | text[]                   |   no | default `{}`                             |
| `token_expires_at`, `data_access_expires_at`, `last_validated_at`  | timestamptz              |  yes | lifecycle metadata                       |
| `user_token_ciphertext`, `user_token_nonce`, `user_token_auth_tag` | bytea                    |  yes | bắt buộc cùng nhau với `user_connected`  |
| `user_token_key_version`                                           | integer                  |  yes | keyring version                          |
| `user_token_fingerprint`                                           | text                     |  yes | non-reversible correlation               |
| `disconnected_at`                                                  | timestamptz              |  yes | audit disconnect                         |
| `provider_metadata`                                                | jsonb                    |   no | safe metadata only                       |
| `created_at`, `updated_at`                                         | timestamptz              |   no |                                          |

Partial unique `(app_user_id,meta_app_id,connection_type)` ngăn user A ghi đè
connection của user B. Check constraint yêu cầu toàn bộ encrypted-token fields cho
`user_connected`.

## `facebook_oauth_states`

Server-side, one-time OAuth state cho App B: `state_hash text PK`,
`app_user_id uuid FK CASCADE`, fixed safe `redirect_path`, `expires_at`,
`consumed_at`, `created_at`. Raw state không được persist. Atomic consume theo hash,
user, expiry và `consumed_at is null` chống replay.

## `pages`

Safe Page metadata and connection health.

| Field                                            | Type              | Null | Constraint                     |
| ------------------------------------------------ | ----------------- | ---: | ------------------------------ |
| `id`                                             | uuid              |   no | PK                             |
| `external_page_id`                               | text              |   no | unique                         |
| `name`                                           | text              |   no |                                |
| `username`, `avatar_url`, `category`, `timezone` | text              |  yes |                                |
| `connection_status`                              | connection_status |   no |                                |
| `last_synced_at`                                 | timestamptz       |  yes |                                |
| `remote_metadata`                                | jsonb             |   no | default `{}`; safe fields only |
| timestamps                                       | timestamptz       |   no |                                |

Index `(connection_status,last_synced_at)`.

## `page_credentials`

Encrypted Page Access Token. Generic Page queries must not select this table.

| Field                                           | Type        | Null | Constraint/meaning                               |
| ----------------------------------------------- | ----------- | ---: | ------------------------------------------------ |
| `id`                                            | uuid        |   no | PK                                               |
| `page_id`                                       | uuid        |   no | FK pages CASCADE                                 |
| `facebook_connection_id`                        | uuid        |  yes | FK connection RESTRICT; null = legacy App A      |
| `access_token_ciphertext`                       | bytea       |   no |                                                  |
| `nonce`, `auth_tag`                             | bytea       |   no | AEAD material                                    |
| `key_version`                                   | integer     |   no |                                                  |
| `token_fingerprint`                             | text        |   no | non-reversible correlation                       |
| `expires_at`, `last_validated_at`, `revoked_at` | timestamptz |  yes |                                                  |
| `provider_metadata`                             | jsonb       |   no | source/App/owner/scopes/capability, không secret |
| timestamps                                      | timestamptz |   no |                                                  |

Unique `(page_id,facebook_connection_id)` cho credential có provenance; partial
unique `page_id` chỉ áp dụng row legacy có connection null. Một Page vì vậy có thể
có App A credential và các App B credential độc lập.

## `user_page_assignments`

Phạm vi Page mà một tài khoản Google được phép sử dụng trong tool. Super Admin có quyền ngầm trên toàn bộ Page nên không cần tạo assignment.

| Field                    | Type        | Null | Constraint                                         |
| ------------------------ | ----------- | ---: | -------------------------------------------------- |
| `id`                     | uuid        |   no | PK                                                 |
| `user_id`                | uuid        |   no | FK app_users CASCADE                               |
| `page_id`                | uuid        |   no | FK pages CASCADE                                   |
| `assigned_by_user_id`    | uuid        |  yes | FK app_users SET NULL                              |
| `facebook_connection_id` | uuid        |  yes | FK connection SET NULL; provenance auto-assignment |
| timestamps               | timestamptz |   no |                                                    |

Unique `(user_id,page_id)`; index `(page_id,user_id)`.

## `assets`

Image/video metadata. Private bytes live in Supabase Storage.

Fields: `id uuid PK`; `page_id uuid NULL FK pages SET NULL`; `storage_key text UNIQUE NOT NULL`; `mime_type text NOT NULL`; `file_size bigint NOT NULL`; `width`, `height integer NULL`; `checksum text NOT NULL`; `original_filename text NOT NULL`; `created_at`; `cleanup_claimed_at NULL`; `deleted_at NULL`. No permanent public URL. Uploaded original is immutable.

`cleanup_claimed_at` là lease ngắn hạn để hai cleanup run không xóa chồng. `deleted_at` chỉ được chốt sau khi Supabase Storage đã xóa object thành công; lease quá 15 phút được phép retry.

## `posts`

Local draft plus remote mapping/cache.

| Field                                    | Type        | Null | Constraint                    |
| ---------------------------------------- | ----------- | ---: | ----------------------------- |
| `id`                                     | uuid        |   no | PK                            |
| `page_id`                                | uuid        |   no | FK pages RESTRICT             |
| `remote_post_id`                         | text        |  yes | unique with page when present |
| `type`                                   | post_type   |   no |                               |
| `message`                                | text        |   no |                               |
| `status`                                 | post_status |   no |                               |
| `scheduled_at`                           | timestamptz |  yes | remote value mirrored in UTC  |
| `published_at`                           | timestamptz |  yes | remote value                  |
| `remote_created_at`, `remote_updated_at` | timestamptz |  yes |                               |
| `last_synced_at`                         | timestamptz |  yes |                               |
| `remote_snapshot`                        | jsonb       |   no | selected non-secret fields    |
| `last_error_code`, `last_error_message`  | text        |  yes | safe normalized error         |
| timestamps                               | timestamptz |   no |                               |

Indexes: unique partial `(page_id,remote_post_id)`; `(page_id,status,scheduled_at)`; `(page_id,published_at DESC)`.

## `post_assets`

Fields: `post_id uuid FK posts CASCADE`; `asset_id uuid FK assets RESTRICT`; `sort_order integer NOT NULL`; `remote_media_id text NULL`; `created_at`. PK `(post_id,asset_id)`; unique `(post_id,sort_order)`.

## `facebook_operations`

Append-only safe request/outcome history.

Fields: `id uuid PK`; `page_id uuid FK pages RESTRICT`; `post_id uuid NULL FK posts SET NULL`; `type operation_type NOT NULL`; `status operation_status NOT NULL`; `remote_post_id text NULL`; `request_fingerprint text NULL`; `request_metadata jsonb NOT NULL`; nullable credential provenance gồm `credential_source`, `facebook_connection_id`, `page_credential_id`, `actor_user_id`; `resolution text NULL`; `resolution_evidence jsonb NOT NULL`; `resolved_by_user_id uuid NULL FK app_users SET NULL`; `resolved_at timestamptz NULL`; `http_status integer NULL`; `provider_error_code`, `provider_error_message` text NULL`; `provider_request_id text NULL`; `started_at`, `finished_at` timestamptz`; `duration_ms integer NULL`. Provenance chỉ định credential/connection đã được chọn trước remote call và không sao chép token/ciphertext/fingerprint. Metadata/evidence chỉ giữ hash nội dung, loại/số lượng media, thời gian dự kiến, remote ID và timestamp; không giữ caption đầy đủ, token, authorization headers, signed URL hoặc raw sensitive provider body.

Indexes `(page_id,started_at DESC)`, `(post_id,started_at DESC)`, `(status,started_at)`, `facebook_connection_id` và `page_credential_id`.

## `ai_generations`

Fields: `id uuid PK`; `post_id uuid NULL FK posts SET NULL`; `page_id uuid FK pages RESTRICT`; `generation_type generation_type NOT NULL`; `provider`, `model`, `template_version` text NOT NULL`; `input_data jsonb NOT NULL`; `output_text text NULL`; `usage_data jsonb NOT NULL DEFAULT '{}'`; `estimated_cost numeric(14,6) NULL`; `status operation_status NOT NULL`; `error jsonb NULL`; `created_at`. Prompts are minimized/redacted and never contain Facebook tokens.

## `sync_cursors`

Fields: `id uuid PK`; `page_id uuid FK pages CASCADE`; `sync_type text NOT NULL`; `cursor text NULL`; `window_start`, `window_end`, `last_success_at` timestamptz NULL`; `last_error jsonb NULL`; `updated_at`. Unique `(page_id,sync_type)`.

## `cron_jobs`

Lease và cursor bền vững cho các cron read-only. Mỗi `job_key` chỉ có một owner còn hạn tại một thời điểm; worker mới chỉ được claim khi lease trống hoặc đã stale.

Fields: `job_key text PK`; `cursor text NULL`; `lease_owner text NULL`; `lease_expires_at`, `last_started_at`, `last_success_at` timestamptz NULL; `last_error jsonb NULL`; `updated_at`.

## ER diagram

```text
app_users ──< facebook_connection ──< page_credentials >── pages
    │                 └──< facebook_oauth_states
    └──< user_page_assignments >──────────────────────────┘
  ├──< posts ──< post_assets >── assets
  ├──< facebook_operations
  ├──< ai_generations
  └──< sync_cursors

cron_jobs (global lease/cursor, không tạo quan hệ với publish intent)
```

## Invariants

- A remote scheduled/published post must have `remote_post_id`.
- Local schedule is not considered accepted until Meta returns success/remote ID.
- A timeout after sending schedule sets operation `uncertain`; reconcile before retry.
- Operation chưa quét đủ dữ liệu remote, còn trong cửa sổ visibility hoặc có nhiều candidate phải ở `needs_attention`; không được kết luận remote absent.
- Missing remote scheduled post becomes `published`, `canceled` or `deleted_remote` only after querying Meta evidence.
- Page credential is decrypted only inside the Meta adapter.
- Credential selection ưu tiên App B credential active của actor, rồi mới dùng App A
  admin-managed credential; không dùng credential App B của user khác.
- System/cron chỉ chọn App A connection-backed hoặc legacy; nếu Page chỉ có
  App B credential thì system nhận `none`, không chọn row user bất kỳ.
- Operation mới ghi exact credential provenance trước remote mutation. System chỉ
  reconcile App A; operation App B cần actor/Admin reconciliation bằng đúng stored
  credential + connection, không fallback App A hoặc App B của user khác. Legacy
  operation thiếu provenance chỉ dùng App A.
- Disconnect App B chỉ revoke credentials/auto-assignments mang cùng
  `facebook_connection_id`; không xóa Page hoặc nội dung remote.
- Admin/member chỉ đọc hoặc thao tác Page có assignment; Super Admin có quyền ngầm trên mọi Page active.

## Removed schemas

No teams, brands, products, campaigns, comments, content approvals, notifications, job outbox, publish worker schedules, pgvector or analytics snapshots in MVP.
