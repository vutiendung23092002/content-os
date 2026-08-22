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
post_status: draft, submitting, scheduled, published, failed, uncertain, canceled, deleted_remote
post_type: text, image
operation_type: sync_pages, publish_now, schedule, update, reschedule, cancel, sync_posts
operation_status: pending, succeeded, failed, uncertain
generation_type: caption, rewrite, idea
app_role: super_admin, admin, member
user_approval_status: pending, approved, rejected, suspended
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

Single-row connection metadata. User token itself remains in server secret manager for MVP.

| Field                      | Type              | Null | Constraint                                  |
| -------------------------- | ----------------- | ---: | ------------------------------------------- |
| `id`                       | uuid              |   no | PK                                          |
| `external_user_id`         | text              |  yes | safe Meta identity metadata                 |
| `status`                   | connection_status |   no |                                             |
| `granted_scopes`           | text[]            |   no | default `{}`                                |
| `token_expires_at`         | timestamptz       |  yes | hint; provider validation remains authority |
| `last_validated_at`        | timestamptz       |  yes |                                             |
| `provider_metadata`        | jsonb             |   no | redacted/minimal                            |
| `created_at`, `updated_at` | timestamptz       |   no |                                             |

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

| Field                                           | Type        | Null | Constraint                 |
| ----------------------------------------------- | ----------- | ---: | -------------------------- |
| `id`                                            | uuid        |   no | PK                         |
| `page_id`                                       | uuid        |   no | unique FK pages CASCADE    |
| `access_token_ciphertext`                       | bytea       |   no |                            |
| `nonce`, `auth_tag`                             | bytea       |   no | AEAD material              |
| `key_version`                                   | integer     |   no |                            |
| `token_fingerprint`                             | text        |   no | non-reversible correlation |
| `expires_at`, `last_validated_at`, `revoked_at` | timestamptz |  yes |                            |
| timestamps                                      | timestamptz |   no |                            |

## `user_page_assignments`

Phạm vi Page mà một tài khoản Google được phép sử dụng trong tool. Super Admin có quyền ngầm trên toàn bộ Page nên không cần tạo assignment.

| Field                 | Type        | Null | Constraint            |
| --------------------- | ----------- | ---: | --------------------- |
| `id`                  | uuid        |   no | PK                    |
| `user_id`             | uuid        |   no | FK app_users CASCADE  |
| `page_id`             | uuid        |   no | FK pages CASCADE      |
| `assigned_by_user_id` | uuid        |  yes | FK app_users SET NULL |
| timestamps            | timestamptz |   no |                       |

Unique `(user_id,page_id)`; index `(page_id,user_id)`.

## `assets`

Image metadata. Private bytes live in Supabase Storage.

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

Fields: `id uuid PK`; `page_id uuid FK pages RESTRICT`; `post_id uuid NULL FK posts SET NULL`; `type operation_type NOT NULL`; `status operation_status NOT NULL`; `remote_post_id text NULL`; `request_fingerprint text NULL`; `http_status integer NULL`; `provider_error_code`, `provider_error_message` text NULL`; `provider_request_id text NULL`; `started_at`, `finished_at` timestamptz`; `duration_ms integer NULL`. Never store token, authorization headers or raw sensitive provider body.

Indexes `(page_id,started_at DESC)`, `(post_id,started_at DESC)`, `(status,started_at)`.

## `ai_generations`

Fields: `id uuid PK`; `post_id uuid NULL FK posts SET NULL`; `page_id uuid FK pages RESTRICT`; `generation_type generation_type NOT NULL`; `provider`, `model`, `template_version` text NOT NULL`; `input_data jsonb NOT NULL`; `output_text text NULL`; `usage_data jsonb NOT NULL DEFAULT '{}'`; `estimated_cost numeric(14,6) NULL`; `status operation_status NOT NULL`; `error jsonb NULL`; `created_at`. Prompts are minimized/redacted and never contain Facebook tokens.

## `sync_cursors`

Fields: `id uuid PK`; `page_id uuid FK pages CASCADE`; `sync_type text NOT NULL`; `cursor text NULL`; `window_start`, `window_end`, `last_success_at` timestamptz NULL`; `last_error jsonb NULL`; `updated_at`. Unique `(page_id,sync_type)`.

## ER diagram

```text
facebook_connection
app_users ──< user_page_assignments >── pages ──1 page_credentials
  ├──< posts ──< post_assets >── assets
  ├──< facebook_operations
  ├──< ai_generations
  └──< sync_cursors
```

## Invariants

- A remote scheduled/published post must have `remote_post_id`.
- Local schedule is not considered accepted until Meta returns success/remote ID.
- A timeout after sending schedule sets operation `uncertain`; reconcile before retry.
- Missing remote scheduled post becomes `published`, `canceled` or `deleted_remote` only after querying Meta evidence.
- Page credential is decrypted only inside the Meta adapter.
- Admin/member chỉ đọc hoặc thao tác Page có assignment; Super Admin có quyền ngầm trên mọi Page active.

## Removed schemas

No teams, brands, products, campaigns, comments, content approvals, notifications, job outbox, publish worker schedules, pgvector or analytics snapshots in MVP.
