# Tech stack

## MVP choices

| Concern           | Choice                                   | Reason                                               |
| ----------------- | ---------------------------------------- | ---------------------------------------------------- |
| Language          | TypeScript strict                        | One language across UI/API/services                  |
| Web               | Next.js App Router                       | Small internal tool, single deployable               |
| Validation        | Zod                                      | Validate env, API inputs and Meta responses          |
| Database          | PostgreSQL via Supabase                  | Drafts, mappings, AI history and sync state          |
| ORM/migrations    | Drizzle ORM/drizzle-kit                  | Typed SQL-oriented schema and reviewable migrations  |
| Meta integration  | Direct Graph API adapter                 | Official documented API only                         |
| Native scheduling | Facebook Page scheduled posts            | Meta publishes at due time                           |
| Reconciliation    | Vercel Cron/host cron                    | Poll only; no exact-time publish worker              |
| Storage           | Private Supabase Storage                 | Signed media upload/URL without exposing credentials |
| AI                | Provider adapter                         | Generate/rewrite/ideas without provider lock-in      |
| Monitoring        | Structured logs; Sentry optional         | Safe operational visibility                          |
| Access protection | localhost/private network/access gateway | Avoid full user system while keeping tool private    |

## Intentionally removed from MVP

- Trigger.dev for publishing.
- pgvector/RAG and historical performance ranking.
- Facebook as an application sign-in provider; Google through Supabase remains
  the only Content OS login.
- WebSocket, Redis, message broker and microservices.
- Kubernetes, GraphQL, Elasticsearch and standalone vector DB.

## Environment variables

```text
DATABASE_URL
FACEBOOK_APP_ID
FACEBOOK_APP_SECRET
FACEBOOK_GRAPH_API_VERSION
FACEBOOK_USER_ACCESS_TOKEN
FACEBOOK_CONNECT_APP_ID
FACEBOOK_CONNECT_APP_SECRET
FACEBOOK_CONNECT_REDIRECT_URI (optional exact callback override)
TOKEN_ENCRYPTION_KEY
TOKEN_ENCRYPTION_KEY_VERSION
TOKEN_ENCRYPTION_PREVIOUS_KEYS
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
ASSET_CLEANUP_SECRET
NEXT_PUBLIC_SITE_URL
INITIAL_ADMIN_EMAIL
APP_ACCESS_SECRET (optional server automation only)
AI_PROVIDER_API_KEY
S3_* or R2_* (only when image upload enabled)
```

Only `NEXT_PUBLIC_*` values may enter client bundles; no Facebook/AI/database/storage secret is public.

## Engineering baseline

- Strict TypeScript, ESLint, Prettier.
- Vitest for services/error parsing/token redaction.
- Integration tests for Drizzle schemas and Meta adapter fixtures.
- CI: install, format check, lint, typecheck, test and build.
- Pin Node/package manager/Graph API version.
- No automatic database schema sync in production.

## Scheduling decision

The app sends the schedule to Meta immediately. It does not enqueue a delayed local publish task. Cron only reconciles remote state, so an application outage at publish time does not cancel a schedule already accepted by Meta.

## External assumptions to verify

- Exact permission names/access tier for the pinned Graph API version.
- Time-window restrictions for `scheduled_publish_time`.
- Text/single-image/multi-image update and scheduling behavior.
- App mode, App Review and Business Verification requirements for the operator/app/Page combination.
