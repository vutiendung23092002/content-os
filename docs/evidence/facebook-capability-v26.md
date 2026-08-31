# Facebook capability evidence — Graph API v26.0

## Run identity

- Result: `PASS`
- Mode: controlled live capability smoke
- Run timestamp: `2026-08-31T03:48:13.553Z`
- Graph API version: `v26.0`
- Designated test Page: `Nero Team`
- Test Page ID: `272240033580932`
- Category: `Nhà thiết kế đồ họa`
- Application timezone assumption: `Asia/Ho_Chi_Minh` / UTC+07:00
- Database persistence: UTC instant

This report contains no access token, app secret, encryption key, signed URL or authorization header.

## Environment and token capability

The current user lookup, managed-Page discovery and direct Page verification all succeeded live. The Page was returned with these Meta tasks:

- `MODERATE`
- `MESSAGING`
- `ANALYZE`
- `ADVERTISE`
- `CREATE_CONTENT`
- `MANAGE`

Meta token inspection returned:

- User token type: `USER`
- Page token type: `PAGE`
- Relevant application scopes present: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_posts`, `pages_manage_engagement`, `pages_manage_metadata`
- Additional returned scopes: `page_events`, `pages_manage_ads`, `pages_manage_cta`, `pages_messaging`, `public_profile`
- Access tier: `NOT_EXPOSED_BY_META_DEBUG_TOKEN`; no tier was inferred or fabricated.

## Capability results

| Capability                            | Evidence level                       | Result                                                                         |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| Current user lookup                   | `VERIFIED_LIVE`                      | Passed                                                                         |
| Managed Page discovery                | `VERIFIED_LIVE`                      | Nero Team discovered                                                           |
| Direct Page verification              | `VERIFIED_LIVE`                      | Passed                                                                         |
| Published posts read                  | `VERIFIED_LIVE`                      | Passed                                                                         |
| Scheduled posts read                  | `VERIFIED_LIVE`                      | Passed                                                                         |
| Pagination                            | `VERIFIED_LIVE`                      | Cursor was returned during the run                                             |
| Plain-text publish/readback           | `VERIFIED_LIVE`                      | Passed                                                                         |
| Native text schedule/readback         | `VERIFIED_LIVE`                      | Passed                                                                         |
| Reschedule/readback                   | `VERIFIED_LIVE`                      | Passed                                                                         |
| Cancel/readback                       | `VERIFIED_LIVE`                      | Passed                                                                         |
| Published-post delete/readback        | `VERIFIED_LIVE`                      | Passed                                                                         |
| Business Suite mutation verification  | `VERIFIED_BY_EXISTING_LIVE_EVIDENCE` | Previously confirmed on the same designated Page test                          |
| App offline at native publish time    | `VERIFIED_BY_EXISTING_LIVE_EVIDENCE` | Native schedule ownership and later remote mirror were previously confirmed    |
| Explicit `+07:00` input → UTC instant | `VERIFIED_BY_CONTRACT_TEST`          | Passed in submission regression test                                           |
| Minimum 20-minute boundary            | `NOT_LIVE_PROBED`                    | Enforced by contract tests; exact live boundary post intentionally not created |
| Maximum 29-day window                 | `NOT_LIVE_PROBED`                    | Enforced by contract tests; exact live boundary post intentionally not created |

The live schedule used the same native Graph contract as production: `published=false` plus Unix `scheduled_publish_time`. It was placed safely inside the configured 20-minute/29-day window, read back from `/scheduled_posts`, rescheduled, read back at the new UTC instant and canceled.

## Artifacts and cleanup

| Artifact                   | Safe remote ID                     | Verification                            | Cleanup                            |
| -------------------------- | ---------------------------------- | --------------------------------------- | ---------------------------------- |
| Plain-text published post  | `272240033580932_1447920824057398` | Published readback passed               | Delete and absence readback passed |
| Native scheduled text post | `272240033580932_1447920860724061` | Schedule and reschedule readback passed | Cancel and absence readback passed |

Cleanup result: `succeeded`. No smoke artifact created by this run remains on the Page.

## Reproduction

Run discovery-only first, with secrets supplied only through the server environment:

```powershell
corepack pnpm facebook:capability-smoke -- --page-id=272240033580932 "--expected-page-name=Nero Team" --confirm-graph-version=v26.0 --discovery-only
```

The write run requires an explicit mode switch:

```powershell
corepack pnpm facebook:capability-smoke -- --page-id=272240033580932 "--expected-page-name=Nero Team" --confirm-graph-version=v26.0 --execute
```

Never run `--execute` against a production Page. The command fails closed unless Page ID, expected Page name and pinned Graph version are all explicitly confirmed.
