# Docker setup: production and staging

Han Content OS supports two independent Docker Compose projects on the same
Windows host. Supabase remains hosted; PostgreSQL, Auth, and Storage are not run
inside this Compose file.

## Topology

```text
social.vutiendung.io.vn
  -> Cloudflare Tunnel
  -> 127.0.0.1:3210
  -> production Compose project
  -> .env.local
  -> production Supabase

staging-social.vutiendung.io.vn
  -> Cloudflare Tunnel
  -> 127.0.0.1:3211
  -> staging Compose project
  -> .env.staging
  -> staging Supabase
```

Both projects can run concurrently. Compose project names isolate containers and
networks. Each `facebook-cron` and `asset-cleanup` service resolves `app` only in
its own project network, so `FACEBOOK_CRON_BASE_URL=http://app:3000` is correct for
both environments. Only loopback host ports are published; container port 3000 is
not exposed publicly.

## Environment files

Real `.env.local` and `.env.staging` files are ignored by Git. Never copy secrets
between them and never add either file to a Docker image. Start from
`.env.example`, then configure each file independently.

Production `.env.local` orchestration values:

```dotenv
HAN_CONTENT_COMPOSE_PROJECT=han-content-os-prod
HAN_CONTENT_IMAGE=han-content-os:prod
HAN_CONTENT_ENV_FILE=.env.local
HAN_CONTENT_PORT=3210
NEXT_PUBLIC_SITE_URL=https://social.vutiendung.io.vn
FACEBOOK_CRON_BASE_URL=http://app:3000
```

Staging `.env.staging` orchestration values:

```dotenv
HAN_CONTENT_COMPOSE_PROJECT=han-content-os-staging
HAN_CONTENT_IMAGE=han-content-os:staging
HAN_CONTENT_ENV_FILE=.env.staging
HAN_CONTENT_PORT=3211
DEPLOYMENT_ENVIRONMENT=staging
STAGING_BASE_URL=https://staging-social.vutiendung.io.vn
NEXT_PUBLIC_SITE_URL=https://staging-social.vutiendung.io.vn
FACEBOOK_CRON_BASE_URL=http://app:3000
```

Staging must have its own `DATABASE_URL`, `DIRECT_DATABASE_URL`, Supabase URL and
keys, Storage bucket, encryption keyring, Meta app secrets and designated test
Page, cron secrets, optional server access secret, and initial Admin. Do not put
real project refs, database URLs, keys, tokens, or email addresses in committed
files or evidence.

`NEXT_PUBLIC_*` values are embedded during the image build. Distinct
`HAN_CONTENT_IMAGE` tags are therefore mandatory: rebuilding staging must not
overwrite the image used by production, or vice versa.

The Compose variables have backward-compatible defaults (`han-content-os`,
`han-content-os:local`, `.env.local`, and `3210`) for an existing production
installation. Operators should set the explicit production values above before
running both stacks concurrently.

## Preflight

Docker Desktop and Docker Compose v2 are required. These commands validate the
rendered configuration without starting or stopping containers:

```powershell
docker compose --env-file .env.local config --quiet
corepack pnpm staging:env-check
docker compose --env-file .env.staging config --quiet
```

The staging check runs first so a missing or incomplete `.env.staging` fails
closed. It does not borrow values from `.env.local` or the parent shell. It reports
only safe error codes and variable names.

Confirm both loopback ports are available before the first start:

```powershell
Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue
```

Do not run a second Windows `next start`, Facebook cron, or asset-cleanup scheduler
for either environment.

## Start and inspect both projects

Start production:

```powershell
docker compose --env-file .env.local up -d --build
```

Start staging independently:

```powershell
docker compose --env-file .env.staging up -d --build
```

Show each project:

```powershell
docker compose --env-file .env.local ps
docker compose --env-file .env.staging ps
```

Read application logs without dumping environment configuration:

```powershell
docker compose --env-file .env.local logs --tail 100 app
docker compose --env-file .env.staging logs --tail 100 app
```

Check local readiness separately:

```powershell
Invoke-RestMethod http://127.0.0.1:3210/api/health
Invoke-RestMethod http://127.0.0.1:3211/api/health
```

## Stop one project only

Stop staging without affecting production:

```powershell
docker compose --env-file .env.staging down
```

Stop production without affecting staging:

```powershell
docker compose --env-file .env.local down
```

Compose derives the project identity from the selected env file. Because the two
`HAN_CONTENT_COMPOSE_PROJECT` values differ, `down` targets only that project's
containers and network. Never add `-v` without reviewing the exact volume targets.

## Environment-aware database and operational commands

Commands that can contact an external system explicitly select an env file. Generic
legacy commands remain production-compatible; prefer the named aliases:

```powershell
corepack pnpm db:ping:prod
corepack pnpm db:check:prod
corepack pnpm db:migrate:prod
corepack pnpm db:verify:prod
corepack pnpm test:db:prod

corepack pnpm db:ping:staging
corepack pnpm db:check:staging
corepack pnpm db:migrate:staging
corepack pnpm db:verify:staging
corepack pnpm test:db:staging
```

Use `build:prod` or `build:staging` when validating an environment-specific Next.js
bundle outside Docker. This matters because `NEXT_PUBLIC_*` values are baked in.

The same `:prod`/`:staging` convention is available for Storage, asset cleanup,
Facebook cron/Page listing/capability smoke, release secret scanning, and Page
credential rotation. These commands can mutate remote state; run them only as the
relevant runbook directs.

The Node env runner loads exactly the selected file, gives it precedence over
conflicting inherited values, removes inherited project variables that the file
does not define, and prevents downstream `@next/env` calls from loading default
files. The isolated restore verifier retains its separate explicit-target guard.

## Updates and rollback

Build each environment with its own selected file and image tag:

```powershell
git pull
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.staging up -d --build
```

Code rollback and database rollback are separate decisions. Redeploy a previously
verified environment-specific image/commit when schema compatibility allows it.
Never run an unreviewed destructive database restore; follow the isolated staging
restore procedure in the [staging runbook](runbooks/staging-deployment.md).

## Checklist

- [ ] `.env.local` and `.env.staging` remain untracked and contain independent credentials.
- [ ] Compose project names, image tags, env files, and host ports differ.
- [ ] Both `config --quiet` checks pass after `staging:env-check`.
- [ ] Production is healthy only on loopback port 3210.
- [ ] Staging is healthy only on loopback port 3211.
- [ ] Cloudflare hostnames route to the intended loopback ports.
- [ ] Supabase/OAuth callback allowlists match each environment's public origin.
- [ ] Cron services call their own project-local `app` service.
- [ ] Staging uses only its designated non-production Facebook Page.
