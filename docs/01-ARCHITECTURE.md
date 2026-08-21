# Architecture

## Kiến trúc mục tiêu

Ứng dụng là modular monolith cho một nhóm nội bộ nhỏ. Supabase Google OAuth + allowlist bảo vệ người dùng; Facebook dùng một credential server-side chung và thực hiện native scheduling, không có publish worker chờ đến giờ.

```text
┌────────────────┐       ┌─────────────────────────────┐
│ Private browser│ ----> │ Next.js App Router          │
│ / access gate  │ <---- │ UI + Route Handlers         │
└────────────────┘       │ services + validation       │
                         └──────┬─────────────┬─────────┘
                                │             │
                                ▼             ▼
                         ┌────────────┐  ┌──────────────┐
                         │ PostgreSQL │  │ S3/R2        │
                         │ drafts     │  │ image assets │
                         │ mappings   │  └──────────────┘
                         │ AI history │
                         └──────┬─────┘
                                │ sync/reconcile
                                ▼
                         ┌──────────────────────┐
                         │ Meta Graph API       │
                         │ Page posts           │
                         │ native schedules     │
                         └──────────────────────┘
```

## Trust boundaries

- Browser không bao giờ nhận Facebook token.
- Server environment/secret manager giữ User Access Token.
- Page tokens được mã hóa nếu persist trong PostgreSQL.
- Meta Graph API là external authority; response phải validate và error phải redact.
- App chỉ được truy cập qua localhost/private network/access gateway.

## Request-time flows

### Sync Pages

```text
POST /api/facebook/sync-pages
-> read User Token server-side
-> GET /me/accounts
-> upsert Page metadata
-> encrypt/store Page Access Token
-> return safe Page DTO
```

### Publish now

```text
Operator confirms
-> create local operation record
-> POST /{page-id}/feed or /photos
-> persist remote post ID
-> refresh published list
```

### Native schedule

```text
Operator selects local time + timezone
-> server converts to UTC/Unix timestamp
-> POST /{page-id}/feed
     published=false
     scheduled_publish_time=...
-> persist remote scheduled post ID
-> fetch /{page-id}/scheduled_posts
```

Once Meta returns success, Meta—not a local timer—is responsible for publishing at the scheduled time.

## Data authority

| Data                | Authority                  | Local responsibility              |
| ------------------- | -------------------------- | --------------------------------- |
| Draft/AI output     | PostgreSQL                 | Edit/history                      |
| Page metadata/token | Meta; encrypted local copy | Sync/health/redaction             |
| Scheduled post      | Meta                       | Mapping/cache and user experience |
| Published post      | Meta                       | Read cache and reconciliation     |
| Media bytes         | S3/R2 when used            | Private ownership/signed access   |

Local status must record `last_synced_at` and must never silently override a contradictory remote response.

## Reconciliation

A lightweight scheduled task (Vercel Cron or equivalent) periodically:

1. Fetches `/{page-id}/scheduled_posts`.
2. Fetches recent published posts.
3. Matches by `remote_post_id`.
4. Updates local mirror/status.
5. Marks missing/changed remote records for operator review.

It does not publish content. Trigger.dev is intentionally deferred; add it only if AI/image jobs or sync volume later need durable workers.

## Failure handling

| Failure                                      | Behavior                                                         |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Meta rejects schedule                        | Keep draft/failed operation; show safe provider error            |
| Request timeout before response              | Query scheduled posts before retry; do not blindly create again  |
| Local DB write fails after Meta success      | Reconcile by returned/request correlation and remote listing     |
| Token revoked/expired                        | Stop writes, mark connection degraded, require token replacement |
| Scheduled post edited in Meta Business Suite | Next sync updates local mirror and records remote change         |
| Scheduled post deleted remotely              | Mark `deleted_remote`; do not recreate automatically             |

## Code organization

```text
src/
  app/
  modules/
    facebook/
    pages/
    posts/
    assets/
    ai/
    sync/
  lib/
    db/
    env/
    crypto/
    logger/
    errors/
    access/
```

Route Handlers call services; services call provider/storage/database adapters. Meta-specific shapes do not leak into UI/domain code.

## Deployment

- Next.js/Vercel or a private Node host.
- PostgreSQL/Supabase.
- Optional S3/R2 for images.
- Vercel Cron or hosting cron for reconciliation.
- Sentry optional with strict token redaction.

## Deferred

Multi-user auth, workflow approval, outbox/Trigger publish, pgvector RAG, analytics dashboards, webhook, multi-platform and AI image pipeline.
