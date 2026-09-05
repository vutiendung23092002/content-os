# HAN CONTENT OS — MVP BACKLOG

Backlog này bao phủ công cụ nội bộ cho một nhóm nhỏ có Google allowlist. Facebook native scheduling là cơ chế đăng đúng giờ; cron của ứng dụng chỉ đồng bộ và đối soát. Mỗi task phải giữ token ngoài client, log, Git và AI prompt.

## Foundation

- [x] FOUND-001 — Initialize repository and runtime
  - Priority: P0
  - Goal: Khởi tạo Git, pin Node LTS/package manager và repository baseline.
  - Depends on: None.
  - Files/modules expected: `.gitignore`, runtime/package-manager pins, root metadata.
  - Acceptance criteria: Fresh clone cài dependency tái lập được; working tree sạch; không có secret.
  - Tests: Kiểm tra install trên workspace sạch và secret-pattern scan.

- [x] FOUND-002 — Scaffold Next.js strict TypeScript
  - Priority: P0
  - Goal: Tạo modular monolith Next.js App Router tối thiểu.
  - Depends on: FOUND-001.
  - Files/modules expected: `src/app`, `src/modules`, `src/lib`, Next/TypeScript config.
  - Acceptance criteria: Dev server và production build chạy; TypeScript strict; server/client boundary rõ.
  - Tests: Build và typecheck pass.

- [x] FOUND-003 — Quality checks, tests and CI
  - Priority: P0
  - Goal: Thiết lập format, lint, typecheck, unit/integration test và CI.
  - Depends on: FOUND-002.
  - Files/modules expected: quality configs, test config, CI workflow, package scripts.
  - Acceptance criteria: Một command local và CI chạy đủ quality gates, không cần production secret.
  - Tests: Cố ý tạo lỗi mẫu để xác nhận từng gate fail đúng rồi hoàn nguyên.

- [x] FOUND-004 — Typed environment configuration
  - Priority: P0
  - Goal: Validate env và tách tuyệt đối server secret khỏi public config.
  - Depends on: FOUND-002.
  - Files/modules expected: `src/lib/env`, `.env.example` không chứa giá trị thật.
  - Acceptance criteria: App fail fast với lỗi dễ hiểu; token/key không được export sang client.
  - Tests: Missing/invalid env, client bundle scan và production-mode validation.

- [x] FOUND-005 — Safe errors and structured logging
  - Priority: P0
  - Goal: Chuẩn hóa request ID, error taxonomy, JSON logging và redaction.
  - Depends on: FOUND-003, FOUND-004.
  - Files/modules expected: `src/lib/errors`, `src/lib/logger`, API error mapper.
  - Acceptance criteria: Lỗi có stable code/request ID; không log header, token, signed URL hoặc full caption.
  - Tests: Redaction table tests và snapshot error contract.

- [x] FOUND-006 — Protect internal application access
  - Priority: P0
  - Goal: Đảm bảo chỉ tài khoản Google được duyệt mới truy cập UI/API nội bộ.
  - Depends on: FOUND-002, FOUND-004.
  - Files/modules expected: middleware/access adapter, cron secret guard, deployment config.
  - Acceptance criteria: UI/API mutation bị chặn khi chưa qua access layer; cron dùng credential riêng.
  - Tests: Unauthorized UI/API/cron requests bị từ chối; authorized request pass.
  - [x] Supabase Google OAuth SSR, logout và proxy bảo vệ UI.
  - [x] Allowlist email trong `app_users`; trạng thái pending/approved/rejected/suspended được kiểm tra lại ở mọi API.
  - [x] Super Admin lấy từ `INITIAL_ADMIN_EMAIL`; Super Admin có thể bổ nhiệm Admin, Admin có thể duyệt/tạm khóa nhân viên.
  - [x] `APP_ACCESS_SECRET` không còn là mật khẩu nhân viên; chỉ còn tùy chọn cho automation/break-glass qua server header.
  - [x] Đưa đăng xuất vào menu tài khoản và cảnh báo khi còn nội dung soạn chưa lưu.
  - [x] Phân quyền Page theo từng tài khoản; Super Admin có toàn bộ Page, Admin/Nhân viên chỉ dùng Page được gán và API kiểm tra quyền ở server.
  - [x] Làm lại màn Nhân sự và panel gán Page theo Liquid Glass nền đục, không nhìn xuyên nội dung.
  - [x] Giảm auth waterfall khi vào Nhân sự bằng verified JWT claims, server-provided initial data và loading boundary tức thời.
  - [x] Đưa nội dung onboarding sang Hướng dẫn nhanh; bỏ trang Tổng quan độc lập và chuyển `/`, đăng nhập mặc định sang `/posts`.
  - [x] Bổ sung `FACEBOOK_CRON_SECRET` riêng cho cron FB-011; không dùng chung secret dọn asset hay credential người dùng.
  - [x] Bỏ topbar dư thừa, đưa menu tài khoản xuống sidebar và đồng bộ indicator điều hướng cho cả link trong nội dung trang.

## Database

- [x] DB-001 — PostgreSQL and Drizzle setup
  - Priority: P0
  - Goal: Cấu hình database connection, Drizzle và migration lifecycle.
  - Depends on: FOUND-003, FOUND-004.
  - Files/modules expected: `src/db`, Drizzle config, migration/test scripts.
  - Acceptance criteria: Empty database migrate được; runtime và migration credential tách được nếu hạ tầng hỗ trợ.
  - Tests: Connection health, migrate up trên database sạch và schema check.

- [x] DB-002 — Minimal MVP schema
  - Priority: P0
  - Goal: Tạo schema đúng [docs/03-DATABASE-DESIGN.md](docs/03-DATABASE-DESIGN.md).
  - Depends on: DB-001.
  - Files/modules expected: schema/migrations cho `facebook_connection`, `pages`, `page_credentials`, `posts`, `facebook_operations`, `ai_generations`, `sync_cursors`.
  - Acceptance criteria: Constraint/index/state enum ngăn duplicate remote mapping và trạng thái vô lý.
  - Tests: Migration, unique/FK/check constraint và rollback-on-transaction tests.

- [x] DB-003 — Repository and transaction boundaries
  - Priority: P0
  - Goal: Tách query khỏi route và hỗ trợ operation intent trước remote mutation.
  - Depends on: DB-002.
  - Files/modules expected: repository interfaces/implementations, unit-of-work helpers.
  - Acceptance criteria: Service không dùng raw query tùy ý; transaction rollback không để state nửa vời.
  - Tests: Repository integration và simulated transaction failure.

## Security and credentials

- [x] SEC-001 — Install Facebook token as server secret
  - Priority: P0
  - Goal: Đọc user access token thủ công từ secret manager/env phía server.
  - Depends on: FOUND-004, FOUND-005.
  - Files/modules expected: server credential provider, deployment secret documentation.
  - Acceptance criteria: Token không nằm trong source, database, browser, telemetry hoặc `.env.example`.
  - Tests: Client bundle/response/log scan và missing-secret behavior.

- [x] SEC-002 — Encrypt Page tokens
  - Priority: P0
  - Goal: Mã hóa authenticated Page token trước khi lưu database.
  - Depends on: DB-002, FOUND-004.
  - Files/modules expected: crypto service, ciphertext/key-version fields, rotation utility.
  - Acceptance criteria: Chỉ Meta adapter được yêu cầu plaintext; key tách khỏi database; tamper bị phát hiện.
  - Tests: Encrypt/decrypt, wrong key, tamper, key-version và rotation tests.
  - [x] Page token được mã hóa at rest bằng AES-256-GCM với ciphertext, nonce 12 byte, auth tag, key version và SHA-256 fingerprint tách biệt.
  - [x] Sync/thêm Page mã hóa token bằng current key/version trước khi persist; database và API response không chứa plaintext.
  - [x] Versioned keyring giải mã đúng stored `keyVersion`, hỗ trợ current/previous keys và fail rõ ràng với version không biết, không fallback.
  - [x] Plaintext của credential đã lưu chỉ tồn tại trong crypto/Meta adapter boundary; post/read/rotation orchestration chỉ truyền encrypted credential.
  - [x] Rotation utility hỗ trợ dry-run và rotate old → current trong một transaction, update có điều kiện, giữ nguyên expiry/validation/revocation metadata và rollback toàn batch khi lỗi; App B encrypted user token dùng cùng keyring cũng được rotate/verify count.
  - [x] Regression tests bao phủ round-trip, wrong valid key, tamper, exact/unknown key version, rotate thành công, dry-run và rollback không corruption.

- [x] SEC-003 — Mutation protection and input limits
  - Priority: P0
  - Goal: Bảo vệ publish/schedule/cancel và AI endpoints khỏi request giả/lạm dụng.
  - Depends on: FOUND-006.
  - Files/modules expected: CSRF/same-site guard, rate limiter, Zod schemas.
  - Acceptance criteria: Mutation cần access context hợp lệ; caption/timestamp/body có giới hạn.
  - Tests: CSRF, oversized payload, invalid timezone và rate-limit tests.
  - [x] Audit toàn bộ browser mutation cho publish, schedule, draft/remote edit-delete, asset upload-delete và quản trị user/Page; mọi route đều có authorization cùng same-origin, còn cron giữ bearer riêng.
  - [x] Thêm regression audit tự động để route `POST`/`PUT`/`PATCH`/`DELETE` mới không được thiếu CSRF hoặc machine-auth boundary và authorization boundary.
  - [x] Rate limit browser mutation theo actor/Page/action bằng atomic fixed-window counter trong PostgreSQL; scope không gắn Page dùng `global`.
  - [x] Giới hạn raw JSON/multipart body trước parse; chuẩn hóa lỗi payload quá lớn, JSON malformed và content type sai.
  - [x] Toàn bộ JSON mutation schema dùng strict Zod; bodyless mutation chỉ chấp nhận body rỗng.
  - [x] Giữ nguyên cron bearer và configured machine-secret behavior; rate limiter chỉ chạy khi có browser actor.
  - [x] Regression tests cho rate-limit exceeded, oversized/malformed/unknown-field payload và mutation hợp lệ.

- [x] SEC-004 — Credential rotation and incident runbook
  - Priority: P1
  - Goal: Có quy trình thay/revoke user token và encryption key an toàn.
  - Depends on: SEC-001, SEC-002, FOUND-005.
  - Files/modules expected: operational runbook, safe rotation command/checklist.
  - Acceptance criteria: Rotation không log plaintext; Page bị lỗi được tạm khóa mutation; recovery được ghi rõ.
  - Tests: Staging rotation drill và invalid-token drill.
  - [x] Operator CLI luôn dry-run trước, hiển thị source/target/count; execution cần `--execute` và xác nhận target version, sau đó verify không còn old-version credential.
  - [x] CLI fail non-zero, chỉ xuất stable event/code/count và không in plaintext token, encryption key hoặc error cause.
  - [x] Meta code `190` được phân biệt thành invalid/revoked token; code `10/200` thành permission missing. Lỗi xác định khóa Page và lưu sanitized incident evidence atomically cùng operation failure.
  - [x] Credential hết hạn được persist thành Page `expired` với sanitized incident evidence, không bị đánh dấu revoked; mutation tiếp theo bị chặn. Timeout/5xx vẫn `uncertain`, không khóa và không blind retry.
  - [x] Page verify/sync thành công upsert credential mới, xóa revoked state và unlock Page; integration test xác nhận lock/recovery.
  - [x] Runbook bao phủ encryption-key rotation/rollback, user-token replacement, revoked/expired token, decryption/unknown-version failure và restore service.
  - [x] Automated integration drill bao phủ dry-run, real rotation trên isolated DB record, old-version verification, failure rollback, crypto lock không bị rotation tự unlock và verified-sync recovery.
  - [x] Operator đã hoàn thành rotation drill trên staging thật; dry-run, rotation, verification, Facebook read smoke và mutation smoke đều pass. Không lưu ID/secret/timestamp không có trong evidence.

## Meta Graph integration

- [x] FB-001 — Meta capability smoke test
  - Priority: P0
  - Goal: Xác minh khả năng cần dùng trên Meta App/Page test và Graph version cụ thể.
  - Depends on: SEC-001.
  - Files/modules expected: `scripts/meta-smoke` hoặc test harness server-only, capability report không secret.
  - Acceptance criteria: Discover Page, publish text, schedule native, list scheduled, list published, reschedule và cancel đều có kết quả ghi nhận; quyền/range/timezone được chốt.
  - Tests: Chạy trên Page test; xác nhận thủ công trong Meta Business Suite; dọn test post an toàn.
  - [x] Graph API đã pin `v26.0`; live evidence có Page discovery, native schedule, published/scheduled reads, reschedule và cancel trên Page test.
  - [x] Page discovery đã ghi nhận task/capability theo Page; các mutation live đã được xác nhận trong Meta Business Suite và test posts tương ứng đã được hủy/xóa.
  - [x] Capability report `docs/evidence/facebook-capability-v26.md` ghi một run `v26.0` hoàn chỉnh: discovery/tasks/scopes/token types, plain-text publish, native schedule, reads/pagination, reschedule/cancel/delete và cleanup IDs. Access tier được ghi đúng là Meta debug-token không expose; exact range boundaries không live-probe và được phân biệt với contract evidence.

- [x] FB-002 — Meta Graph adapter
  - Priority: P0
  - Goal: Đóng gói mọi request Graph trong một adapter pin version.
  - Depends on: FB-001, FOUND-005.
  - Files/modules expected: `src/modules/facebook/meta-client`, DTO/error mapper/pagination.
  - Acceptance criteria: Có timeout, selected fields, normalized errors và không log URL/token.
  - Tests: Contract fixtures cho success, pagination, 4xx, 5xx, rate limit, timeout và malformed response.
  - [x] Mọi Graph request trong application đi qua `MetaGraphClient`, dùng version bắt buộc từ `FACEBOOK_GRAPH_API_VERSION`, Bearer header, selected fields, cursor riêng và timeout mặc định 15 giây.
  - [x] Contract tests bao phủ success/pagination/4xx/5xx/429/timeout/malformed response; provider message, token và provider next URL không thoát ra DTO/error.

- [x] FB-003 — Sync managed Pages and Page tokens
  - Priority: P0
  - Goal: Lấy Page được quản lý từ user token và lưu Page token mã hóa.
  - Depends on: FB-002, SEC-002, DB-003.
  - Files/modules expected: Facebook connection service, Page repositories, `/api/facebook/sync-pages`.
  - Acceptance criteria: Upsert Page ổn định; Page bị mất quyền được đánh dấu; response không chứa credential.
  - Tests: First sync, repeat sync, renamed Page, removed Page, partial API failure và ciphertext assertion.
  - [x] Managed Page snapshot chỉ persist sau khi đọc hết pagination; partial/repeated-cursor snapshot không reconcile Page bị thiếu.
  - [x] Upsert theo stable external Page ID, cập nhật Page đổi tên, mã hóa token trước persistence và chỉ trả safe DTO.
  - [x] Page từng đến từ managed-page discovery nhưng biến mất khỏi snapshot hoàn chỉnh được đánh dấu `permission_missing`; Page thêm thủ công không bị ảnh hưởng và repeat sync có thể đưa Page trở lại `active`.
  - [x] Cho mọi tài khoản đã duyệt kiểm tra quyền và thêm Page bằng ID; thêm Page không tự cấp quyền sử dụng cho người thêm.
  - [x] Chỉ Admin/Super Admin được gỡ Page khỏi hệ thống; soft-delete thu hồi assignment, ẩn Page với mọi tài khoản và không gọi thao tác xóa lên Facebook.

- [x] FB-004 — Publish text now
  - Priority: P0
  - Goal: Đăng một draft text ngay lên Page bằng Graph API chính thức.
  - Depends on: FB-002, FB-003, POST-001.
  - Files/modules expected: publish use-case, operation ledger integration, publish API route.
  - Acceptance criteria: Ghi intent trước request; lưu remote post ID; chỉ Page active có credential hợp lệ được publish.
  - Tests: Success, permission failure, validation, double submit/idempotency, timeout `uncertain` và database failure sau remote success.
  - [x] Transaction claim draft và tạo pending operation hoàn tất trước Meta request; successful response persist remote Post ID.
  - [x] Active Page/credential guard, atomic duplicate claim, permission failure, timeout `uncertain` không retry và remote-success/local-failure đều có regression evidence.

- [x] FB-005 — Create Facebook-native scheduled text post
  - Priority: P0
  - Goal: Giao lịch cho Facebook bằng `published=false` và `scheduled_publish_time`.
  - Depends on: FB-004.
  - Files/modules expected: schedule use-case/API, schedule validation, remote mapping.
  - Acceptance criteria: Remote scheduled post xuất hiện trên Facebook; app không tạo due-time publish job; lưu timezone/UTC đúng.
  - Tests: Valid boundaries từ capability report, invalid/past time, DST/timezone, duplicate submit và app offline tại giờ đăng.
  - [x] Native scheduling gửi `published=false` và Unix `scheduled_publish_time`; không có due-time publish worker, cron chỉ đọc/reconcile.
  - [x] Live Page-test evidence xác nhận native scheduled posts; tests bao phủ past/20-minute/29-day boundaries, ISO timezone offset → UTC, duplicate claim và remote publish được mirror sau app downtime.
  - [x] Capability report `v26.0` xác nhận native schedule/readback/reschedule/cancel live trên Page test và liên kết rõ policy 20 phút/29 ngày, timezone offset → UTC với contract tests; exact boundary posts được ghi `NOT_LIVE_PROBED` thay vì tạo artifact rủi ro.

- [x] FB-006 — Sync published posts
  - Priority: P0
  - Goal: Lấy danh sách bài đã đăng của Page và mirror tối thiểu.
  - Depends on: FB-002, DB-003.
  - Files/modules expected: published sync service, cursor handling, published API route.
  - Acceptance criteria: Bài tạo ngoài tool vẫn được upsert; mapping local draft được giữ; có `lastSyncedAt`.
  - Tests: Pagination, repeat sync, external post, edited/deleted remote post và transient failure.
  - [x] Complete-window pagination mirror upsert external posts, giữ local row identity theo `(pageId, remotePostId)`, cập nhật edits/`lastSyncedAt` và tombstone remote deletion.
  - [x] Pagination/repeat/edit/delete/transient incomplete snapshot/stale cache có unit và DB integration coverage; live `v26.0` reads đã trả 50 bài và week-window 81 bài.

- [x] FB-007 — Sync Facebook scheduled posts
  - Priority: P0
  - Goal: Lấy scheduled list trực tiếp từ Facebook thay vì suy đoán từ local state.
  - Depends on: FB-002, DB-003.
  - Files/modules expected: scheduled sync service, cursor handling, scheduled API route.
  - Acceptance criteria: Phản ánh lịch tạo/sửa/xóa ngoài tool; không xóa local record ngay sau một lần missing.
  - Tests: Pagination, external schedule, changed time, removed remote, repeat sync và timeout stale-state behavior.
  - [x] Scheduled list luôn đọc remote `/scheduled_posts`, phân trang toàn snapshot rồi mới mirror; external/repeat/changed-time/remove paths có integration coverage.
  - [x] Missing row dùng grace 10 phút, incomplete/timeout snapshot không reconcile và stale cache vẫn được trả; live scheduled-list read đã thành công trên `v26.0`.

- [x] FB-008 — Reschedule remote post
  - Priority: P0
  - Goal: Đổi `scheduled_publish_time` của bài đang scheduled trên Facebook.
  - Depends on: FB-005, FB-007.
  - Files/modules expected: reschedule use-case/API, operation record.
  - Acceptance criteria: Chỉ remote scheduled post hợp lệ được đổi; trạng thái được đọc lại sau mutation.
  - Tests: Success, invalid range, already published, missing remote, permission loss và timeout reconciliation.
  - [x] API `PATCH /api/posts/:postId/reschedule` kiểm tra same-origin và quyền Page hiện tại.
  - [x] Ghi operation `reschedule` trước mutation, chỉ cập nhật lịch local sau khi đọc lại đúng Post ID và giờ mới từ Facebook.
  - [x] Timeout/readback lỗi đi qua FB-010; cron chỉ đọc đối soát, không blind retry mutation.
  - [x] Unit/route/cron tests cho success, range, published, missing, permission, timeout và readback mismatch.
  - [x] UI thao tác đổi lịch từ menu `•••` trong popup chi tiết bài hẹn giờ, có xác nhận và refetch remote sau mutation.
  - [x] Live smoke đổi lịch trên Page test và xác minh lại trong Facebook Business Suite.

- [x] FB-009 — Cancel remote scheduled post
  - Priority: P0
  - Goal: Hủy/xóa lịch remote qua API chính thức đã xác minh.
  - Depends on: FB-005, FB-007.
  - Files/modules expected: cancel use-case/API, tombstone/local state mapping.
  - Acceptance criteria: Người vận hành thấy kết quả xác nhận; retry không xóa nhầm object khác.
  - Tests: Success, already absent, already published, permission failure, double click và timeout.
  - [x] API `DELETE /api/posts/:postId/remote` kiểm tra same-origin, quyền Page hiện tại và remote mapping trước khi gọi Meta.
  - [x] Ghi operation trước mutation; local mirror chỉ tombstone sau khi Meta xác nhận.
  - [x] Retryable/timeout và lỗi local persistence sau remote success đi vào trạng thái `uncertain`, không retry mù.
  - [x] Unit tests cho success, Meta failure, retryable uncertain và remote-success/local-persist-failure.
  - [x] UI hủy lịch từ menu `•••` trong popup chi tiết bài hẹn giờ, có popup xác nhận và toast kết quả.
  - [x] Live smoke hủy lịch trên Page test và xác minh lại trong Facebook Business Suite.

- [x] FB-010 — Reconcile uncertain operations
  - Priority: P0
  - Goal: Xác định request timeout/DB failure đã tạo remote object hay chưa trước khi retry.
  - Depends on: FB-004, FB-005, FB-006, FB-007.
  - Files/modules expected: reconciliation service, operation queries, manual retry/resolve API.
  - Acceptance criteria: Không blind retry create; unresolved case hiển thị `needs_attention`; quyết định có evidence.
  - Tests: Remote success + local timeout, remote failure + timeout, ambiguous match, DB write failure và safe manual resolution.
  - [x] Lưu intent metadata tối thiểu (hash nội dung, loại/số media, lịch UTC) trước khi gọi Meta; không lưu caption/token/signed URL trong evidence.
  - [x] Chỉ tự chốt khi quét remote đầy đủ và có đúng một candidate; incomplete/no-match/ambiguous/visibility-window chuyển `needs_attention` và không retry create.
  - [x] API Admin liệt kê, chạy đối soát và resolve thủ công có same-origin guard, actor audit và xác minh lại candidate từ Facebook.
  - [x] Migration `0005_exotic_shinko_yamashiro.sql` đã áp dụng; unit/API/schema và Supabase transaction integration tests pass.

- [x] FB-011 — Scheduled sync and reconciliation cron
  - Priority: P1
  - Goal: Chạy sync/reconciliation định kỳ mà không tạo publish worker.
  - Depends on: FB-006, FB-007, FB-010, FOUND-006.
  - Files/modules expected: cron routes, cursor/lease/lock service, deployment schedule.
  - Acceptance criteria: Batch có cursor; không chạy chồng; retry hữu hạn; app downtime không ảnh hưởng native publish.
  - Tests: Lock contention, partial batch failure, resume cursor, stale lease và offline-at-publish-time scenario.
  - [x] Hai cron route chỉ đọc dùng bearer secret riêng; không có publish worker hoặc mutation Facebook.
  - [x] Batch Page có cursor, lease toàn cục, checkpoint sau từng Page và tự nhận lại stale lease.
  - [x] Retry hữu hạn tối đa hai lần cho lỗi tạm thời; lỗi từng phần giữ cursor để lần sau chạy tiếp.
  - [x] Cron đối soát chỉ tự xử lý `uncertain`/stale `pending`; `needs_attention` chờ Admin, không lặp vô hạn.
  - [x] Có script host cron cho Windows và test lock contention, partial failure, resume cursor, stale lease, app offline lúc Facebook native publish.
  - [x] Migration `0006_faithful_spitfire.sql` đã áp dụng lên Supabase; stale-lease integration test pass.

- [ ] FB-012 — Per-user Facebook onboarding with Meta App B
  - Priority: P1
  - Goal: Cho approved Content OS user kết nối Facebook riêng, chọn Page họ quản lý
    mà không thay thế Google login hoặc App A admin-managed.
  - Depends on: FOUND-006, SEC-002, SEC-003, FB-002, FB-003.
  - Acceptance criteria: OAuth state one-time/user-bound; App B token validation;
    encrypted user/Page credentials có provenance; assignment và disconnect cô lập
    theo user/connection; App A backward compatible.
  - Tests: OAuth/callback failures, App mismatch, Page verification, multi-user
    isolation, disconnect/reconnect, migration/repository integration và secret scan.
  - [x] Additive migrations `0008`/`0009` thêm per-user connection, hashed OAuth
        state, credential/assignment provenance và safe credential metadata; không đổi
        plaintext/encryption format của App A rows.
  - [x] Server-side App B connect/callback, code exchange, long-lived token inspect,
        Page discovery/selection, encrypted persistence và same-origin/rate-limited
        disconnect đã implement với strict validation.
  - [x] Browser read/mutation chọn owned App B credential trước rồi App A fallback;
        cron/system chỉ chọn App A và không bao giờ fallback App B. Reconnect đổi
        Facebook identity và credential incident đều cô lập provenance/assignment.
  - [x] Sync cron checkpoint/skip Page không có App A usable và tiếp tục batch;
        disconnect/identity switch recompute affected Page health nhưng availability
        của App B không cấp quyền App B cho cron.
  - [x] Additive migration `0010` thêm nullable operation credential provenance;
        mutation ghi provenance trước remote call, cron chỉ reconcile App A, App B
        chuyển `needs_attention` chờ exact-provenance Admin reconciliation và legacy
        operation không đoán App B.
  - [x] UI Pages có connect/reconnect/disconnect, Page selection và không expose raw
        User/Page token; Google vẫn là Supabase login provider duy nhất.
  - [x] Unit/migration tests pass; DB integration drill đã được thêm nhưng chỉ chạy
        trên database an toàn sau khi áp dụng migration.
  - [ ] Cấu hình Meta App B staging thật và hoàn tất live acceptance: Google/App A
        regression, OAuth App B, designated Page select, encrypted rows/assignment,
        read/write capability, user isolation, disconnect/reconnect và clean logs.
  - [ ] Xác nhận App mode/Business Verification/Advanced Access/App Review phù hợp
        trước production external-user rollout; không suy ra approval từ automated tests.

## Posts and operator UI

- [x] POST-001 — Draft CRUD service
  - Priority: P0
  - Goal: Tạo/sửa/xóa draft text theo Page với state rule tối thiểu.
  - Depends on: DB-003, SEC-003, FB-003.
  - Files/modules expected: posts domain/repository/service/API schemas.
  - Acceptance criteria: Draft tách remote mirror; submitted content không bị sửa im lặng; Page inactive bị từ chối.
  - Tests: CRUD, validation, state transition, concurrent update và Page boundary tests.

- [x] POST-002 — Draft editor UI
  - Priority: P0
  - Goal: Cho operator chọn Page, soạn caption và lưu draft.
  - Depends on: POST-001.
  - Files/modules expected: editor page/components, form state, server actions/API client.
  - Acceptance criteria: Có unsaved/error/loading state; timezone hiển thị rõ; không có token field.
  - Tests: Component/form tests và draft creation E2E.
  - [x] Composer Liquid Glass có Page picker kèm avatar, caption editor, vùng AI dự kiến, upload tối đa 10 ảnh, kéo thả đổi thứ tự và preview bố cục.
  - [x] Bổ sung lựa chọn Video thường của Page, preview trong composer và không cho trộn ảnh/video trong cùng draft.

- [x] POST-003 — Published and scheduled list UI
  - Priority: P0
  - Goal: Hiển thị hai danh sách remote với lần sync gần nhất.
  - Depends on: FB-006, FB-007.
  - Files/modules expected: Page post screens, filters, pagination, refresh controls.
  - Acceptance criteria: Phân biệt local/external post, stale/error state và permalink; không hiển thị số liệu giả.
  - Tests: Empty/loading/stale/error/paginated UI và manual refresh E2E.
  - [x] Khôi phục bộ lọc Page, refresh, pagination, xem chi tiết và chuyển đổi Bảng/Timeline bằng dữ liệu GET trực tiếp từ Facebook.
  - [x] Đặt Timeline làm mặc định, highlight toàn cột hôm nay, mở rộng layout màn hình lớn và áp dụng liquid-glass/bento visual system.
  - [x] Đồng bộ Liquid Glass toàn ứng dụng: shell, dashboard, form, bảng, timeline, dropdown và modal dùng nền kính đục, viền sáng và chiều sâu thống nhất.
  - [x] Thêm Liquid Glass indicator trượt mượt giữa các mục điều hướng trong sidebar và tôn trọng chế độ giảm chuyển động.
  - [x] Tự ẩn khung giờ 00:00–07:00 khi tuần không có bài sáng sớm và tự mở lại khi có dữ liệu.
  - [x] Thay select Page mặc định bằng Page picker có avatar, category, trạng thái kết nối và điều hướng bàn phím.
  - [x] Đồng bộ avatar Page từ Meta và thu gọn Page picker cho màn hình desktop.
  - [x] Hiển thị tổng Reaction, Comment và Share trên Bảng/Timeline từ dữ liệu đọc trực tiếp của Meta.
  - [x] Hiển thị gallery đầy đủ từ Facebook attachments trong popup chi tiết bài viết.
  - [x] Tối ưu vị trí nút đóng popup trên mobile và resolve permalink công khai từ composite Post ID trước khi mở Facebook.
  - [x] Tự giãn chiều cao từng khung giờ Timeline để các card đăng gần nhau không chồng lấn.
  - [x] Tự phân trang để tải đủ dữ liệu của tuần đang xem trên Timeline; bỏ nút tải thêm thủ công khỏi chế độ này.
  - [x] Cache theo Page/tab/tuần ở trình duyệt, mirror tuần trong Supabase, lọc Meta bằng `since/until` và stale-while-refresh để quay lại tab không phải tải lại.
  - [x] Hoàn thiện persisted sync/mirror và E2E đầy đủ sau FB-006/FB-007 trước khi đóng task POST-003.

- [x] POST-004 — Publish and schedule controls
  - Priority: P0
  - Goal: Cho operator xác nhận đăng ngay hoặc chọn lịch native.
  - Depends on: POST-002, FB-004, FB-005.
  - Files/modules expected: confirmation dialogs, schedule picker, operation feedback.
  - Acceptance criteria: Double click an toàn; timezone/range rõ; operation `uncertain` không được báo thất bại chắc chắn.
  - Tests: Publish/schedule happy path, double submit, invalid time và uncertain-state UI E2E.
  - [x] Có lựa chọn đăng ngay/native schedule, API giữ giới hạn 20 phút–29 ngày; nút "Sớm nhất" chủ động chọn sau ít nhất 25 phút để có khoảng đệm tải ảnh, và có confirmation cuối trước mọi thao tác Meta.
  - [x] UI gọi draft trước rồi mới submit, giữ operation ledger và không tự retry khi kết quả remote không chắc chắn.
  - [x] Live publish một bài có ảnh trên Page test Nero Team; operation thành công và lưu remote post ID để đối soát.
  - [x] Chạy capability smoke trên Page test và E2E thật trước khi đóng task.

- [x] POST-005 — Reschedule, cancel and attention UI
  - Priority: P0
  - Goal: Quản lý remote scheduled post và các operation cần xử lý.
  - Depends on: POST-003, FB-008, FB-009, FB-010.
  - Files/modules expected: scheduled row actions, attention panel, safe confirmation UI.
  - Acceptance criteria: UI refresh từ Meta sau mutation; destructive action có xác nhận; không cho retry mù.
  - Tests: Reschedule/cancel/absent/published/uncertain E2E states.
  - [x] Menu `•••` trong popup chi tiết bài viết đã có hành động theo trạng thái: bài hẹn giờ có đổi lịch/sửa nội dung/hủy lịch; bài đã đăng có sửa nội dung/xóa bài.
  - [x] Confirmation dialog Liquid Glass cho từng mutation, khóa thao tác khi đang submit và đóng đúng thứ tự bằng Escape/backdrop.
  - [x] Smart toast cho thành công/thất bại; sau mutation refetch lại dữ liệu remote theo Page/tab/tuần.
  - [x] Disable hành động mutation với bài external chưa có local mapping để tránh sửa/xóa nhầm.
  - [x] E2E/live smoke trên Page test cho reschedule, edit scheduled, cancel scheduled, edit published và delete published.

## AI content assistant

- [ ] AI-001 — Content AI provider abstraction
  - Priority: P1
  - Goal: Tạo provider interface với timeout, normalized usage và error.
  - Depends on: FOUND-004, FOUND-005, SEC-003.
  - Files/modules expected: `src/modules/ai/providers`, DTOs, config.
  - Acceptance criteria: Provider secret server-only; provider có thể mock; không tự failover sang bên thứ ba khác.
  - Tests: Mock contract, timeout, rate limit, invalid output và secret redaction.

- [ ] AI-002 — Generate caption options
  - Priority: P1
  - Goal: Tạo nhiều caption có cấu trúc từ brief và Page context tối thiểu.
  - Depends on: AI-001, DB-002.
  - Files/modules expected: caption use-case/API, prompt templates, `ai_generations` repository.
  - Acceptance criteria: Validate số lượng/độ dài; lưu usage; không gửi Facebook credential.
  - Tests: Prompt input allowlist, structured output, provider failure và history persistence.

- [ ] AI-003 — Rewrite and idea suggestions
  - Priority: P1
  - Goal: Hỗ trợ rewrite, CTA/hashtag và ý tưởng nội dung.
  - Depends on: AI-002.
  - Files/modules expected: rewrite/ideas use-cases, APIs, prompt templates.
  - Acceptance criteria: Mỗi tác vụ có schema; output luôn được gắn nhãn draft AI.
  - Tests: Tone/length inputs, malformed output, harmful claim warning và rate limits.

- [ ] AI-004 — Human-in-the-loop AI UI
  - Priority: P1
  - Goal: Hiển thị lựa chọn AI mà không tự ghi đè draft.
  - Depends on: POST-002, AI-002, AI-003.
  - Files/modules expected: AI assistant panel, compare/apply controls.
  - Acceptance criteria: Chỉ `Use this version` mới cập nhật editor; publish/schedule vẫn là thao tác riêng.
  - Tests: Generate, dismiss, apply, edit-after-apply và never-auto-publish E2E.

- [ ] AI-005 — AI guardrails, budget and deletion
  - Priority: P1
  - Goal: Giới hạn usage, cảnh báo claim rủi ro và cho xóa AI history.
  - Depends on: AI-002, AI-003.
  - Files/modules expected: quota service, content checks, history deletion API/UI.
  - Acceptance criteria: Budget/rate limit cấu hình được; xóa history không xóa draft; prompt/log không có secret.
  - Tests: Budget exceeded, warning categories, deletion integrity và credential scan.

- [ ] AI-006 — Image AI provider abstraction and generation
  - Goal: Image-capable provider interface, bounded aspect ratio/count, normalized cost/status/error and async jobs when required.

- [ ] AI-007 — Generated image ingestion and composer assets
  - Goal: Fetch provider output server-side, validate/store private assets, then attach a selected image through the existing composer flow.

## Image publishing extension

- [x] ASSET-001 — Private object storage
  - Priority: P2
  - Goal: Cấu hình private bucket và signed upload lifecycle.
  - Depends on: FOUND-004, DB-002.
  - Files/modules expected: storage adapter, `assets`/`post_assets` migration, upload intent API.
  - Acceptance criteria: Object private mặc định; URL ngắn hạn; key không do client tùy ý quyết định.
  - Tests: Signature expiry, unauthorized access, object-key validation và cleanup protection.
  - [x] Adapter private Supabase Storage, upload server-only, signed URL ngắn hạn và metadata/checksum trong `assets`.
  - [x] Tạo bucket private `post-assets`, hỗ trợ JPEG/PNG/WebP và một video MP4/MOV tối đa 50 MB; smoke upload/cleanup thành công qua localhost lẫn Cloudflare Tunnel.

- [x] ASSET-002 — Multi-image upload and preview
  - Priority: P2
  - Goal: Upload/validate tối đa 10 JPEG/PNG/WebP, sắp xếp thứ tự và gắn vào draft.
  - Depends on: ASSET-001, POST-002.
  - Files/modules expected: asset service, completion API, uploader/preview UI.
  - Acceptance criteria: MIME/dung lượng/kích thước hợp lệ; asset lỗi không được publish; remove an toàn.
  - Tests: Valid formats, spoofed MIME, oversized/corrupt file, retry và detach tests.
  - [x] Composer có chọn/kéo thả file, preview, kéo card để đổi thứ tự, xóa ảnh và cleanup asset chưa gắn khi luồng tạo draft lỗi.
  - [x] Bổ sung kiểm tra magic bytes/dimension phía server và storage integration test trước khi đóng task.

- [x] ASSET-003 — Publish and schedule multiple images
  - Priority: P2
  - Goal: Mở rộng Meta adapter cho bài có tối đa 10 ảnh theo đúng thứ tự sau khi text flow ổn định.
  - Depends on: ASSET-002, FB-004, FB-005, FB-010.
  - Files/modules expected: Meta photo adapter/use-cases, operation metadata.
  - Acceptance criteria: Publish/schedule/lists đối soát được remote ID; URL không chứa token; không coi multi-image là carousel hoặc video.
  - Tests: Publish, schedule, Meta media-fetch failure, timeout reconciliation và app-offline scenario.
  - [x] Meta adapter upload ảnh với `published=false`, gom `media_fbid` vào `attached_media`, rồi đăng ngay hoặc tạo lịch native trên Page feed.
  - [x] Lưu từng `media_fbid` theo đúng `sort_order`; contract tests bao phủ publish, native schedule, lỗi media fetch, app offline và timeout không blind retry.
  - [x] Scheduled list đọc `attachments/subattachments` để preview đủ toàn bộ ảnh trước giờ đăng, không chỉ dùng một `full_picture` đại diện.
  - [x] Xác minh read-only dữ liệu Page test: 1 lượt đăng ngay và 2 lượt hẹn giờ nhiều ảnh đã có remote post ID thành công.
  - [x] FB-010 đối soát operation `uncertain` bằng evidence từ remote thay vì tự retry.

- [x] ASSET-005 — Page video publishing
  - Priority: P1
  - Goal: Đăng ngay hoặc hẹn giờ native một video thường của Facebook Page.
  - [x] Signed upload trực tiếp lên private Supabase Storage và cleanup asset dở dang.
  - [x] Draft phân loại `video`, chỉ nhận đúng một MP4/MOV và không trộn với ảnh.
  - [x] Meta adapter dùng Page `/videos` với `file_url`, `description`, `published=false` và `scheduled_publish_time` khi hẹn giờ.
  - [x] Composer có lựa chọn Ảnh/Video, preview video và trạng thái Facebook đang xử lý mã hóa.
  - [x] Cập nhật bucket `post-assets` lên 50 MB và allow MIME video trên Supabase Cloud.
  - [x] Live smoke đăng ngay/hẹn giờ chỉ trên Page test được cho phép, rồi đối soát remote video ID và trạng thái mã hóa.
  - [ ] Reel publishing là task riêng qua `video_reels`, không coi video thường là Reel.

- [x] ASSET-004 — Private image lifecycle cleanup
  - Priority: P1
  - Goal: Không giữ ảnh vô hạn nhưng không làm mất dữ liệu cần retry hoặc đối soát.
  - Depends on: ASSET-001, ASSET-002, FB-007.
  - [x] Cleanup service giữ trạng thái chưa thành công/chưa chắc chắn, dọn orphan quá 1 giờ, dọn ảnh sau Meta success và giữ video thêm 24 giờ.
  - [x] Claim lease 15 phút, rollback claim khi Storage lỗi, soft-delete metadata sau khi object đã xóa.
  - [x] Endpoint `GET/POST /api/cron/assets/cleanup` dùng dedicated bearer secret; không gọi mutation Facebook.
  - [x] Unit test và Supabase transaction integration test cho ảnh/video thành công, scheduled, thiếu operation, failed, uncertain, draft và orphan.
  - [x] Cấu hình `ASSET_CLEANUP_SECRET`, scheduler Docker chạy mỗi giờ và storage integration smoke trước khi đóng task.

## Operations and release

- [ ] OBS-001 — Metrics, tracing and alerts
  - Priority: P1
  - Goal: Quan sát publish/schedule/sync/AI mà không lộ content hay credential.
  - Depends on: FOUND-005, FB-004, FB-005, FB-010.
  - Files/modules expected: metrics hooks, tracing config, alert rules/dashboards.
  - Acceptance criteria: Theo dõi outcome/latency/uncertain/stale sync/credential error; alerts có owner.
  - Tests: Emit assertions, redaction scan và staging alert drill.

- [ ] OBS-002 — Operational runbooks
  - Priority: P1
  - Goal: Chuẩn hóa xử lý token mất hiệu lực, schedule missing, uncertain operation và cron failure.
  - Depends on: OBS-001, SEC-004, FB-011.
  - Files/modules expected: `docs/runbooks` hoặc deployment handbook.
  - Acceptance criteria: Mỗi runbook có detection, safe diagnosis, recovery, escalation và không khuyên blind retry.
  - Tests: Tabletop drill trên staging cho ít nhất bốn sự cố.

- [ ] DEPLOY-001 — Staging deployment
  - Priority: P0
  - Goal: Deploy môi trường staging được bảo vệ với database, secrets và Page test.
  - Depends on: FOUND-006, DB-002, SEC-002, FB-003.
  - Files/modules expected: deployment config, migration/release scripts, environment checklist.
  - Acceptance criteria: Không public; secret ở platform storage; migration/rollback/backup rõ; health check pass.
  - Tests: Fresh deploy, unauthorized access, secret scan, database restore sample và Meta smoke test.
  - Trạng thái audit: `PARTIAL` — repository-side readiness hoàn tất; chưa có evidence cho deployment/restore drill thật.
  - [x] Docker runtime bind loopback, chạy non-root; Google login/allowlist/Page authorization và dedicated cron credentials giữ nguyên.
  - [x] Production/staging Compose project, image tag, runtime env file và host port tách biệt; explicit env runner fail-closed không fallback `.env.local`, hỗ trợ hai stack đồng thời trên cùng Windows host.
  - [x] Staging environment/secret classification và fail-closed `staging:env-check`; capability Page variables chỉ dành cho local/staging smoke.
  - [x] Release sequence dùng alias explicit `:prod`/`:staging` cho DB và operational scripts; rollback code tách biệt database restore/forward-fix.
  - [x] `/api/health` kiểm tra runtime database, trả `503` sanitized khi dependency unavailable và có regression tests.
  - [x] Read-only `staging:access-smoke` cho protected page/API, Admin API, cron credentials và legacy password endpoint.
  - [x] `release:secret-scan` kiểm tra tracked files và built client assets mà không in secret; evidence template không chứa credential.
  - [x] Runbook backup/restore PostgreSQL/Supabase staging cô lập; verifier fail-closed pin cả schema và DB integration tests vào đúng isolated restore target, không fallback `.env.local`.
  - [x] Meta staging checklist tái sử dụng hardened capability smoke, bắt buộc discovery-only trước và không chạy write smoke trong CI.
  - [ ] Operator provision staging tách production, đặt private access gateway/platform secret storage và hoàn tất fresh-deploy evidence.
  - [ ] Operator thực hiện backup/restore sample trên isolated staging target và ghi dated evidence.
  - [ ] Operator chạy unauthorized/authenticated/Page-read/Meta staging smoke, rollback rehearsal và ghi dated evidence.

- [ ] DEPLOY-002 — MVP production readiness review
  - Priority: P0
  - Goal: Chỉ mở production sau khi compliance, security và native scheduling được chứng minh.
  - Depends on: POST-005, FB-011, OBS-001, DEPLOY-001.
  - Files/modules expected: release checklist, capability evidence, Meta policy/review notes.
  - Acceptance criteria: Tất cả P0 pass; token rotation/reconciliation/backup tested; Graph version pin; không có scraper/browser automation.
  - Tests: Full staging E2E gồm app offline tại giờ đăng, permission loss, timeout và recovery drill.

## Explicitly deferred

Không tạo task triển khai cho OAuth Facebook đa tenant, team/workflow duyệt nội dung, full analytics, carousel/Reels, pgvector hoặc Trigger.dev cho đến khi có nhu cầu mới được xác nhận. Video thường của Page, Google allowlist, role và phân quyền Page cho nhóm nội bộ đã được xác nhận và triển khai.
