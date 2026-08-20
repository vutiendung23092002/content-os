# HAN CONTENT OS — MVP BACKLOG

Backlog này chỉ bao phủ công cụ nội bộ một người vận hành. Facebook native scheduling là cơ chế đăng đúng giờ; cron của ứng dụng chỉ đồng bộ và đối soát. Mỗi task phải giữ token ngoài client, log, Git và AI prompt.

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

- [ ] FOUND-006 — Protect internal application access
  - Priority: P0
  - Goal: Đảm bảo tool single-operator không public dù không có auth nhiều người dùng.
  - Depends on: FOUND-002, FOUND-004.
  - Files/modules expected: middleware/access adapter, cron secret guard, deployment config.
  - Acceptance criteria: UI/API mutation bị chặn khi chưa qua access layer; cron dùng credential riêng.
  - Tests: Unauthorized UI/API/cron requests bị từ chối; authorized request pass.

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

- [ ] SEC-002 — Encrypt Page tokens
  - Priority: P0
  - Goal: Mã hóa authenticated Page token trước khi lưu database.
  - Depends on: DB-002, FOUND-004.
  - Files/modules expected: crypto service, ciphertext/key-version fields, rotation utility.
  - Acceptance criteria: Chỉ Meta adapter được yêu cầu plaintext; key tách khỏi database; tamper bị phát hiện.
  - Tests: Encrypt/decrypt, wrong key, tamper, key-version và rotation tests.

- [ ] SEC-003 — Mutation protection and input limits
  - Priority: P0
  - Goal: Bảo vệ publish/schedule/cancel và AI endpoints khỏi request giả/lạm dụng.
  - Depends on: FOUND-006.
  - Files/modules expected: CSRF/same-site guard, rate limiter, Zod schemas.
  - Acceptance criteria: Mutation cần access context hợp lệ; caption/timestamp/body có giới hạn.
  - Tests: CSRF, oversized payload, invalid timezone và rate-limit tests.

- [ ] SEC-004 — Credential rotation and incident runbook
  - Priority: P1
  - Goal: Có quy trình thay/revoke user token và encryption key an toàn.
  - Depends on: SEC-001, SEC-002, FOUND-005.
  - Files/modules expected: operational runbook, safe rotation command/checklist.
  - Acceptance criteria: Rotation không log plaintext; Page bị lỗi được tạm khóa mutation; recovery được ghi rõ.
  - Tests: Staging rotation drill và invalid-token drill.

## Meta Graph integration

- [ ] FB-001 — Meta capability smoke test
  - Priority: P0
  - Goal: Xác minh khả năng cần dùng trên Meta App/Page test và Graph version cụ thể.
  - Depends on: SEC-001.
  - Files/modules expected: `scripts/meta-smoke` hoặc test harness server-only, capability report không secret.
  - Acceptance criteria: Discover Page, publish text, schedule native, list scheduled, list published, reschedule và cancel đều có kết quả ghi nhận; quyền/range/timezone được chốt.
  - Tests: Chạy trên Page test; xác nhận thủ công trong Meta Business Suite; dọn test post an toàn.

- [ ] FB-002 — Meta Graph adapter
  - Priority: P0
  - Goal: Đóng gói mọi request Graph trong một adapter pin version.
  - Depends on: FB-001, FOUND-005.
  - Files/modules expected: `src/modules/facebook/meta-client`, DTO/error mapper/pagination.
  - Acceptance criteria: Có timeout, selected fields, normalized errors và không log URL/token.
  - Tests: Contract fixtures cho success, pagination, 4xx, 5xx, rate limit, timeout và malformed response.

- [ ] FB-003 — Sync managed Pages and Page tokens
  - Priority: P0
  - Goal: Lấy Page được quản lý từ user token và lưu Page token mã hóa.
  - Depends on: FB-002, SEC-002, DB-003.
  - Files/modules expected: Facebook connection service, Page repositories, `/api/facebook/sync-pages`.
  - Acceptance criteria: Upsert Page ổn định; Page bị mất quyền được đánh dấu; response không chứa credential.
  - Tests: First sync, repeat sync, renamed Page, removed Page, partial API failure và ciphertext assertion.

- [ ] FB-004 — Publish text now
  - Priority: P0
  - Goal: Đăng một draft text ngay lên Page bằng Graph API chính thức.
  - Depends on: FB-002, FB-003, POST-001.
  - Files/modules expected: publish use-case, operation ledger integration, publish API route.
  - Acceptance criteria: Ghi intent trước request; lưu remote post ID; chỉ Page active có credential hợp lệ được publish.
  - Tests: Success, permission failure, validation, double submit/idempotency, timeout `uncertain` và database failure sau remote success.

- [ ] FB-005 — Create Facebook-native scheduled text post
  - Priority: P0
  - Goal: Giao lịch cho Facebook bằng `published=false` và `scheduled_publish_time`.
  - Depends on: FB-004.
  - Files/modules expected: schedule use-case/API, schedule validation, remote mapping.
  - Acceptance criteria: Remote scheduled post xuất hiện trên Facebook; app không tạo due-time publish job; lưu timezone/UTC đúng.
  - Tests: Valid boundaries từ capability report, invalid/past time, DST/timezone, duplicate submit và app offline tại giờ đăng.

- [ ] FB-006 — Sync published posts
  - Priority: P0
  - Goal: Lấy danh sách bài đã đăng của Page và mirror tối thiểu.
  - Depends on: FB-002, DB-003.
  - Files/modules expected: published sync service, cursor handling, published API route.
  - Acceptance criteria: Bài tạo ngoài tool vẫn được upsert; mapping local draft được giữ; có `lastSyncedAt`.
  - Tests: Pagination, repeat sync, external post, edited/deleted remote post và transient failure.

- [ ] FB-007 — Sync Facebook scheduled posts
  - Priority: P0
  - Goal: Lấy scheduled list trực tiếp từ Facebook thay vì suy đoán từ local state.
  - Depends on: FB-002, DB-003.
  - Files/modules expected: scheduled sync service, cursor handling, scheduled API route.
  - Acceptance criteria: Phản ánh lịch tạo/sửa/xóa ngoài tool; không xóa local record ngay sau một lần missing.
  - Tests: Pagination, external schedule, changed time, removed remote, repeat sync và timeout stale-state behavior.

- [ ] FB-008 — Reschedule remote post
  - Priority: P0
  - Goal: Đổi `scheduled_publish_time` của bài đang scheduled trên Facebook.
  - Depends on: FB-005, FB-007.
  - Files/modules expected: reschedule use-case/API, operation record.
  - Acceptance criteria: Chỉ remote scheduled post hợp lệ được đổi; trạng thái được đọc lại sau mutation.
  - Tests: Success, invalid range, already published, missing remote, permission loss và timeout reconciliation.

- [ ] FB-009 — Cancel remote scheduled post
  - Priority: P0
  - Goal: Hủy/xóa lịch remote qua API chính thức đã xác minh.
  - Depends on: FB-005, FB-007.
  - Files/modules expected: cancel use-case/API, tombstone/local state mapping.
  - Acceptance criteria: Người vận hành thấy kết quả xác nhận; retry không xóa nhầm object khác.
  - Tests: Success, already absent, already published, permission failure, double click và timeout.

- [ ] FB-010 — Reconcile uncertain operations
  - Priority: P0
  - Goal: Xác định request timeout/DB failure đã tạo remote object hay chưa trước khi retry.
  - Depends on: FB-004, FB-005, FB-006, FB-007.
  - Files/modules expected: reconciliation service, operation queries, manual retry/resolve API.
  - Acceptance criteria: Không blind retry create; unresolved case hiển thị `needs_attention`; quyết định có evidence.
  - Tests: Remote success + local timeout, remote failure + timeout, ambiguous match, DB write failure và safe manual resolution.

- [ ] FB-011 — Scheduled sync and reconciliation cron
  - Priority: P1
  - Goal: Chạy sync/reconciliation định kỳ mà không tạo publish worker.
  - Depends on: FB-006, FB-007, FB-010, FOUND-006.
  - Files/modules expected: cron routes, cursor/lease/lock service, deployment schedule.
  - Acceptance criteria: Batch có cursor; không chạy chồng; retry hữu hạn; app downtime không ảnh hưởng native publish.
  - Tests: Lock contention, partial batch failure, resume cursor, stale lease và offline-at-publish-time scenario.

## Posts and operator UI

- [x] POST-001 — Draft CRUD service
  - Priority: P0
  - Goal: Tạo/sửa/xóa draft text theo Page với state rule tối thiểu.
  - Depends on: DB-003, SEC-003, FB-003.
  - Files/modules expected: posts domain/repository/service/API schemas.
  - Acceptance criteria: Draft tách remote mirror; submitted content không bị sửa im lặng; Page inactive bị từ chối.
  - Tests: CRUD, validation, state transition, concurrent update và Page boundary tests.

- [ ] POST-002 — Draft editor UI
  - Priority: P0
  - Goal: Cho operator chọn Page, soạn caption và lưu draft.
  - Depends on: POST-001.
  - Files/modules expected: editor page/components, form state, server actions/API client.
  - Acceptance criteria: Có unsaved/error/loading state; timezone hiển thị rõ; không có token field.
  - Tests: Component/form tests và draft creation E2E.

- [ ] POST-003 — Published and scheduled list UI
  - Priority: P0
  - Goal: Hiển thị hai danh sách remote với lần sync gần nhất.
  - Depends on: FB-006, FB-007.
  - Files/modules expected: Page post screens, filters, pagination, refresh controls.
  - Acceptance criteria: Phân biệt local/external post, stale/error state và permalink; không hiển thị số liệu giả.
  - Tests: Empty/loading/stale/error/paginated UI và manual refresh E2E.

- [ ] POST-004 — Publish and schedule controls
  - Priority: P0
  - Goal: Cho operator xác nhận đăng ngay hoặc chọn lịch native.
  - Depends on: POST-002, FB-004, FB-005.
  - Files/modules expected: confirmation dialogs, schedule picker, operation feedback.
  - Acceptance criteria: Double click an toàn; timezone/range rõ; operation `uncertain` không được báo thất bại chắc chắn.
  - Tests: Publish/schedule happy path, double submit, invalid time và uncertain-state UI E2E.

- [ ] POST-005 — Reschedule, cancel and attention UI
  - Priority: P0
  - Goal: Quản lý remote scheduled post và các operation cần xử lý.
  - Depends on: POST-003, FB-008, FB-009, FB-010.
  - Files/modules expected: scheduled row actions, attention panel, safe confirmation UI.
  - Acceptance criteria: UI refresh từ Meta sau mutation; destructive action có xác nhận; không cho retry mù.
  - Tests: Reschedule/cancel/absent/published/uncertain E2E states.

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

## Single-image extension

- [ ] ASSET-001 — Private object storage
  - Priority: P2
  - Goal: Cấu hình private bucket và signed upload lifecycle.
  - Depends on: FOUND-004, DB-002.
  - Files/modules expected: storage adapter, `assets`/`post_assets` migration, upload intent API.
  - Acceptance criteria: Object private mặc định; URL ngắn hạn; key không do client tùy ý quyết định.
  - Tests: Signature expiry, unauthorized access, object-key validation và cleanup protection.

- [ ] ASSET-002 — Single-image upload and preview
  - Priority: P2
  - Goal: Upload/validate một JPEG/PNG/WebP và gắn vào draft.
  - Depends on: ASSET-001, POST-002.
  - Files/modules expected: asset service, completion API, uploader/preview UI.
  - Acceptance criteria: MIME/dung lượng/kích thước hợp lệ; asset lỗi không được publish; remove an toàn.
  - Tests: Valid formats, spoofed MIME, oversized/corrupt file, retry và detach tests.

- [ ] ASSET-003 — Publish and schedule one image
  - Priority: P2
  - Goal: Mở rộng Meta adapter cho single-image post sau khi text flow ổn định.
  - Depends on: ASSET-002, FB-004, FB-005, FB-010.
  - Files/modules expected: Meta photo adapter/use-cases, operation metadata.
  - Acceptance criteria: Publish/schedule/lists đối soát được remote ID; URL không chứa token; không hỗ trợ carousel/video ngầm.
  - Tests: Publish, schedule, Meta media-fetch failure, timeout reconciliation và app-offline scenario.

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

- [ ] DEPLOY-002 — MVP production readiness review
  - Priority: P0
  - Goal: Chỉ mở production sau khi compliance, security và native scheduling được chứng minh.
  - Depends on: POST-005, FB-011, OBS-001, DEPLOY-001.
  - Files/modules expected: release checklist, capability evidence, Meta policy/review notes.
  - Acceptance criteria: Tất cả P0 pass; token rotation/reconciliation/backup tested; Graph version pin; không có scraper/browser automation.
  - Tests: Full staging E2E gồm app offline tại giờ đăng, permission loss, timeout và recovery drill.

## Explicitly deferred

Không tạo task triển khai cho multi-user, OAuth khách hàng, team/role, approval workflow, full analytics, AI image, video/carousel/Reels, pgvector hoặc Trigger.dev cho đến khi có nhu cầu mới được xác nhận. Nếu phạm vi thay đổi, cập nhật ADR và product docs trước khi thêm backlog.
