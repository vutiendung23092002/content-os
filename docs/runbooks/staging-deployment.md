# Staging deployment and recovery runbook

## Status and platform boundary

This repository defines a production-style Docker image and Docker Compose runtime,
but it does not select or configure a hosted deployment platform. DEPLOY-001 is
therefore repository-ready but remains incomplete until an operator provisions a
real, isolated staging target and records the live drills below.

The staging target must be separate from production at every boundary:

- a separate Supabase project/database/Auth/Storage bucket;
- a separate deployment hostname and OAuth redirect allowlist;
- access through a private network, VPN or identity-aware gateway, in addition to
  the application's Google login and database allowlist;
- only the designated non-production Facebook test Page;
- independent secrets, cron credentials and encryption keyring;
- no production database URL, Page token, service-role key or backup restore.

Docker Compose binds the application to `127.0.0.1` by default. If a tunnel or
reverse proxy exposes staging, the operator must enforce the access gateway before
the deployment is considered private. A public hostname with only obscurity is not
acceptable.

## Environment and secret checklist

Set `DEPLOYMENT_ENVIRONMENT=staging` in staging. The repository does not require
this marker for normal production runtime; it gates only staging verification
tools. Store every secret in the selected platform's encrypted secret storage or a
host-local ignored environment file. Never put secrets in image layers, build
arguments, GitHub Actions variables intended for client builds, command output or
Git.

| Classification           | Variables                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime configuration    | `FACEBOOK_GRAPH_API_VERSION`, `TOKEN_ENCRYPTION_KEY_VERSION`, `SUPABASE_STORAGE_BUCKET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `FACEBOOK_CRON_BASE_URL`, `HAN_CONTENT_PORT`, `INITIAL_ADMIN_EMAIL`                           |
| Server secrets           | `DATABASE_URL`, `DIRECT_DATABASE_URL`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_USER_ACCESS_TOKEN`, `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_PREVIOUS_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `ASSET_CLEANUP_SECRET`, `FACEBOOK_CRON_SECRET`, optional `APP_ACCESS_SECRET` |
| Staging/local smoke only | `DEPLOYMENT_ENVIRONMENT=staging`, `STAGING_BASE_URL`, `FACEBOOK_CAPABILITY_TEST_PAGE_ID`, `FACEBOOK_CAPABILITY_TEST_PAGE_NAME`                                                                                                                                                     |
| Intentionally absent     | `AI_PROVIDER_API_KEY` while AI is deferred; capability-test variables in normal production runtime                                                                                                                                                                                 |

Before release:

```powershell
corepack pnpm staging:env-check
git status --short
git ls-files .env.local
```

The final command must return no file. The environment check prints variable names
and safe error codes only, never values. It cannot prove that a supplied database or
Page belongs to staging; the operator must compare project/Page identity in the
provider consoles without copying credentials into evidence.

## Safe release sequence

Use a clean checkout of the intended commit. Commands below are existing project
commands and must target the staging environment only.

1. Install and validate the release artifact:

   ```powershell
   corepack pnpm install --frozen-lockfile
   corepack pnpm staging:env-check
   corepack pnpm format:check
   corepack pnpm lint
   corepack pnpm typecheck
   corepack pnpm test
   corepack pnpm build
   corepack pnpm release:secret-scan
   ```

2. Check both staging database connections and migration files:

   ```powershell
   corepack pnpm db:ping
   corepack pnpm db:check
   ```

3. Create and verify the staging backup checkpoint described below. Record only
   backup identifier, timestamp, target environment and verification status.
4. Apply and verify migrations:

   ```powershell
   corepack pnpm db:migrate
   corepack pnpm db:verify
   corepack pnpm test:db
   ```

5. Deploy/start the already-built commit using the platform selected by the
   operator. For the repository Docker runtime, follow
   [Docker setup](../17-DOCKER-SETUP.md); do not place secrets in build args.
6. Wait for `/api/health` to return HTTP 200 with database `ok`, then run:

   ```powershell
   corepack pnpm staging:access-smoke
   ```

7. Complete authenticated login, Page/read and Meta checks below. Do not promote
   this artifact to production as part of DEPLOY-001.

## Rollback and database recovery

Code rollback and database recovery are separate decisions:

- If the schema remains backward-compatible, stop the failed application release
  and redeploy the previously verified image/commit. Re-run health and read-only
  smoke checks.
- Do not blindly reverse generated SQL and do not run destructive `DROP`, down
  migration or restore against production. Drizzle migrations may be irreversible.
- If the old application cannot operate with the migrated schema, keep staging
  unavailable, diagnose the migration and prefer a reviewed forward fix.
- Restore the checkpoint only into the isolated staging database when a forward fix
  is unsafe. Confirm the target project/host twice, terminate staging writers, then
  follow the restore drill below. Re-run `db:verify`, `test:db`, health and access
  smoke before reopening staging.

## Health readiness

`GET /api/health` performs a bounded database query through the runtime connection.
It returns HTTP 200 with `database: ok` when ready and HTTP 503 with
`database: unavailable` when the dependency cannot be reached. The response never
includes connection strings, exception messages or credentials. This is a readiness
check, not an observability/metrics system.

## Unauthorized-access verification

`staging:access-smoke` is read-only and verifies the live staging deployment:

- `/posts` redirects an unauthenticated request to `/login`;
- protected and Admin APIs return 401 without a session;
- Facebook and asset-cleanup cron routes return 401 without their dedicated bearer
  credential;
- the removed legacy password endpoint returns 404.

Run it through the internal/gateway-authorized staging URL so requests reach the
application. Separately verify from outside the gateway that the application is not
openly reachable. Existing automated evidence covers role and machine boundaries:

- `src/modules/auth/admin-policy.test.ts` verifies Admin/Super Admin role limits;
- `src/lib/access/internal-access.test.ts` verifies Google session or dedicated
  automation access;
- `src/lib/access/cron-access.test.ts` verifies separate cron credentials;
- `src/app/api/mutation-security.test.ts` audits authorization, same-origin, body
  and rate-limit boundaries on mutation routes;
- `src/proxy.ts` enforces login, approval and Admin-page routing.

For the live authenticated drill, sign in with one approved staging member and one
staging Admin. Confirm the member cannot access `/admin`, while the Admin can read
the user directory. Do not change production users.

## Secret exposure verification

Run `release:secret-scan` only after `build`. It scans Git-tracked text files and
`.next/static`, checks credential-shaped patterns and compares configured server
secret values without printing those values. A missing client build or any finding
returns non-zero. Review the finding rule/path; never paste the matching content
into a ticket. The existing logger and Meta adapter tests remain the detailed
redaction evidence.

## Staging PostgreSQL/Supabase backup and restore drill

Use the staging Supabase managed backup/restore feature when available. A portable
PostgreSQL drill may use `pg_dump`/`pg_restore`, with source and target connection
fields supplied through temporary operator environment variables. Do not put a URL
on the command line, in shell history or in the repository.

1. Confirm the source project is staging. Set `PGHOST`, `PGPORT`, `PGDATABASE`,
   `PGUSER` and `PGPASSWORD` in a non-recorded operator session.
2. Create a custom-format backup outside the repository:

   ```powershell
   pg_dump --format=custom --no-owner --no-privileges --file=<secure-staging-backup-path>
   pg_restore --list <secure-staging-backup-path>
   ```

3. Provision a new isolated restore target that has no production network route or
   credentials. Replace the temporary PostgreSQL environment variables with this
   target and confirm its project/host twice.
4. Restore only into that isolated target:

   ```powershell
   pg_restore --clean --if-exists --no-owner --no-privileges --dbname=$env:PGDATABASE <secure-staging-backup-path>
   corepack pnpm db:verify
   corepack pnpm test:db
   ```

5. Verify a safe sample using counts/IDs only: expected schema/table count, one
   non-secret Page metadata row if present, and application startup/health. Never
   export captions, tokens or ciphertext into evidence.
6. Verify credential encryption by querying aggregate validity only. The result must
   show no plaintext token column and every credential row must have non-empty
   ciphertext, nonce, authentication tag, positive key version and fingerprint.
   Do not select or print those column values.
7. Delete the isolated restore target and backup according to the staging retention
   policy. Clear temporary PostgreSQL environment variables.

Record the drill in the evidence checklist with safe counts and outcome only. Until
this real restore succeeds, the backup/restore acceptance criterion remains pending.

## Meta staging smoke

Use only the hardened command and designated non-production Page configured by
`FACEBOOK_CAPABILITY_TEST_PAGE_ID` and
`FACEBOOK_CAPABILITY_TEST_PAGE_NAME`. Confirm the Page identity in Meta Business
Suite, then run discovery first:

```powershell
corepack pnpm facebook:capability-smoke -- --page-id=<test-page-id> "--expected-page-name=<test-page-name>" --confirm-graph-version=v26.0 --discovery-only
```

The write smoke remains an explicit operator action with `--execute`. It must not
run in CI. The tool rejects Page/version mismatches, never retries an unknown create
outcome and cleans only the exact unique marker match. Production Page IDs and names
must never be configured as capability-test variables.

## Fresh staging evidence checklist

Record commit/image digest, timestamps and PASS/FAIL only—never environment values:

- [ ] Clean checkout and frozen install.
- [ ] Staging environment check, quality gates, build and release secret scan pass.
- [ ] Staging DB connectivity/check, verified backup checkpoint, migrate, verify and
      `test:db` pass.
- [ ] Deployment health reports database ready.
- [ ] External gateway blocks open access; internal unauthorized smoke passes.
- [ ] Approved staging member/Admin login and role checks pass.
- [ ] Staging Page/read smoke passes.
- [ ] Capability discovery passes on the designated test Page.
- [ ] Explicit capability write smoke/cleanup passes if required for this release.
- [ ] Isolated staging backup restore drill passes.
- [ ] Rollback owner, previous artifact and recovery checkpoint are recorded.

DEPLOY-001 can be closed only after a real staging deployment and all required live
drills above have dated evidence.
