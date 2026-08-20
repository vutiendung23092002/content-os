# Tech stack

## MVP choices

| Concern           | Choice                                   | Reason                                              |
| ----------------- | ---------------------------------------- | --------------------------------------------------- |
| Language          | TypeScript strict                        | One language across UI/API/services                 |
| Web               | Next.js App Router                       | Small internal tool, single deployable              |
| Validation        | Zod                                      | Validate env, API inputs and Meta responses         |
| Database          | PostgreSQL via Supabase                  | Drafts, mappings, AI history and sync state         |
| ORM/migrations    | Drizzle ORM/drizzle-kit                  | Typed SQL-oriented schema and reviewable migrations |
| Meta integration  | Direct Graph API adapter                 | Official documented API only                        |
| Native scheduling | Facebook Page scheduled posts            | Meta publishes at due time                          |
| Reconciliation    | Vercel Cron/host cron                    | Poll only; no exact-time publish worker             |
| Storage           | S3/R2, optional for image MVP            | Controlled media URL and immutable files            |
| AI                | Provider adapter                         | Generate/rewrite/ideas without provider lock-in     |
| Monitoring        | Structured logs; Sentry optional         | Safe operational visibility                         |
| Access protection | localhost/private network/access gateway | Avoid full user system while keeping tool private   |

## Intentionally removed from MVP

- Trigger.dev for publishing.
- pgvector/RAG and historical performance ranking.
- Auth provider, invite, users/teams/roles.
- WebSocket, Redis, message broker and microservices.
- Kubernetes, GraphQL, Elasticsearch and standalone vector DB.

## Environment variables

```text
DATABASE_URL
FACEBOOK_APP_ID
FACEBOOK_APP_SECRET
FACEBOOK_GRAPH_API_VERSION
FACEBOOK_USER_ACCESS_TOKEN
TOKEN_ENCRYPTION_KEY
APP_ACCESS_SECRET or access-gateway config
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
