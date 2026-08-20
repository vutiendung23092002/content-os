# Database design

## Principles

- Keep schema small and single-operator.
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
```

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

## `assets`

Optional image metadata. Private bytes live in S3/R2.

Fields: `id uuid PK`; `page_id uuid NULL FK pages SET NULL`; `storage_key text UNIQUE NOT NULL`; `mime_type text NOT NULL`; `file_size bigint NOT NULL`; `width`, `height integer NULL`; `checksum text NOT NULL`; `original_filename text NOT NULL`; `created_at`; `deleted_at NULL`. No permanent public URL. Uploaded original is immutable.

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
pages ──1 page_credentials
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

## Removed schemas

No `users`, `teams`, `brands`, `products`, `campaigns`, `page_members`, assignments, comments, approvals, notifications, job outbox, publish worker schedules, pgvector or analytics snapshots in MVP.
