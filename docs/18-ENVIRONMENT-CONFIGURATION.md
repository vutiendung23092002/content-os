# Cấu hình môi trường production và staging

Tài liệu này là nguồn hướng dẫn thực hành để điền `.env.local` và
`.env.staging`. Không đưa hai file này vào Git, ticket, chat, ảnh chụp hoặc log.

## Mô hình đơn giản

```text
Cùng một source code
    |
    +-- .env.local
    |     -> production
    |     -> production Docker project/image
    |     -> host port 3210
    |     -> production Supabase
    |     -> production Meta resources
    |
    +-- .env.staging
          -> staging
          -> staging Docker project/image
          -> host port 3211
          -> staging Supabase
          -> designated non-production Meta Page
```

Hai file không tạo ra hai codebase. Chúng cấp cấu hình khác nhau cho cùng một
codebase. Các command có hậu tố `:prod` chọn `.env.local`; command `:staging`
chọn `.env.staging`. Runner xóa các biến cấu hình dự án được kế thừa từ shell,
nạp đúng file đã chọn và chặn `@next/env` tự bổ sung giá trị từ `.env.local`.
Thiếu biến staging sẽ fail closed, không vay giá trị production.

## Build-time và runtime

Ba biến public sau được dùng ở browser và có thể được đóng vào Next.js bundle khi
build:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

Chúng không phải secret. Vì bundle production và staging chứa public config khác
nhau, hai môi trường phải dùng image tag khác nhau:

```dotenv
# Production
HAN_CONTENT_IMAGE=han-content-os:prod

# Staging
HAN_CONTENT_IMAGE=han-content-os:staging
```

Các secret server-side như database URL, service-role key, Meta token, encryption
key và cron secret chỉ được cấp ở runtime. Không thêm tiền tố `NEXT_PUBLIC_` cho
chúng. Đổi một biến `NEXT_PUBLIC_*` cần build lại đúng image của môi trường đó;
restart image cũ không thay đổi bundle.

## Bảng tham chiếu đầy đủ

Quy ước: “Có” nghĩa là cần cho deployment đầy đủ hiện tại; “Tùy chọn” nghĩa là
chỉ cần khi dùng capability tương ứng. Staging readiness cố ý nghiêm hơn schema
runtime và yêu cầu toàn bộ Page-management/cron configuration.

Audit source hiện tại xác nhận mọi tên trong `.env.example` đều được Compose,
runtime hoặc operational tooling dùng. Không có biến deprecated trong template.
`LOG_LEVEL` là biến thật của logger từng bị thiếu khỏi template và đã được bổ sung;
các marker runner/restore tạm thời được tách ở phần riêng bên dưới.

### A. Docker và environment identity

| Variable                      | Mục đích                                             | Prod                | Staging        | Secret? | Lấy/tạo ở đâu                     | Cấu hình sai                                                                  |
| ----------------------------- | ---------------------------------------------------- | ------------------- | -------------- | ------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `HAN_CONTENT_COMPOSE_PROJECT` | Tên project cô lập container và network Compose.     | Có                  | Có             | Không   | Operator tự đặt.                  | Có thể tạo stack thứ hai hoặc thao tác nhầm stack.                            |
| `HAN_CONTENT_IMAGE`           | Image name/tag chứa bundle đúng môi trường.          | Có                  | Có             | Không   | Operator tự đặt.                  | Hai môi trường có thể ghi đè/reuse bundle public của nhau.                    |
| `HAN_CONTENT_ENV_FILE`        | File được Compose cấp cho container runtime.         | `.env.local`        | `.env.staging` | Không   | Theo tên file local đã chọn.      | Runtime có thể nhận database/secret của môi trường khác; guard chặn mismatch. |
| `HAN_CONTENT_PORT`            | Loopback host port ánh xạ vào container port `3000`. | `3210`              | `3211`         | Không   | Theo topology host hiện tại.      | Xung đột bind hoặc Cloudflare route vào sai app.                              |
| `DEPLOYMENT_ENVIRONMENT`      | Marker để staging tooling xác nhận đúng môi trường.  | Không đặt `staging` | Có             | Không   | Giá trị vận hành do operator đặt. | Production bị guard từ chối hoặc staging không qua readiness.                 |

`HAN_CONTENT_COMPOSE_PROJECT` không phải nhãn có thể đổi tùy ý. Production lịch
sử có thể đang chạy dưới tên `han-content-os`; production mới có thể dùng
`han-content-os-prod`. Đổi tên tạo một Compose project mới chứ không rename các
container đang chạy. Installation hiện hữu phải giữ identity đang dùng, trừ khi
có controlled cutover. Staging bắt buộc dùng `han-content-os-staging`. Không bao
giờ chạy đồng thời hai production project cùng bind port `3210`.

Hai stack đều dùng internal port `3000` vì mỗi project có network riêng:

```text
127.0.0.1:3210 -> production app:3000
127.0.0.1:3211 -> staging app:3000
```

### B. Application URLs

| Variable                 | Mục đích                                            | Prod  | Staging | Secret? | Lấy/tạo ở đâu                    | Cấu hình sai                                            |
| ------------------------ | --------------------------------------------------- | ----- | ------- | ------- | -------------------------------- | ------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`   | Public origin cho app, OAuth redirect và client.    | Có    | Có      | Không   | Public hostname của môi trường.  | Redirect/callback hoặc client origin đi sai môi trường. |
| `STAGING_BASE_URL`       | Target HTTPS cho staging verification/access smoke. | Không | Có      | Không   | Public staging hostname.         | Smoke có thể gọi nhầm host; validator từ chối.          |
| `FACEBOOK_CRON_BASE_URL` | Base URL mà cron runner gọi API nội bộ.             | Có    | Có      | Không   | `http://app:3000` trong Compose. | Cron không kết nối được hoặc gọi nhầm deployment.       |

Với staging hiện tại, cả `STAGING_BASE_URL` và `NEXT_PUBLIC_SITE_URL` phải có
origin `https://staging-social.vutiendung.io.vn`. URL không được chứa username,
password hoặc token. Production dùng public origin riêng và không được đánh dấu
`DEPLOYMENT_ENVIRONMENT=staging`.

`FACEBOOK_CRON_BASE_URL=http://app:3000` dùng được ở cả hai Compose project vì
`app` được Docker DNS phân giải trong network riêng của từng project. Đây là URL
nội bộ container, không phải public hostname.

### C. PostgreSQL

| Variable              | Mục đích                                                      | Prod | Staging | Secret? | Lấy/tạo ở đâu                                     | Cấu hình sai                                                  |
| --------------------- | ------------------------------------------------------------- | ---- | ------- | ------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`        | Kết nối database của app/runtime; ưu tiên pooled khi phù hợp. | Có   | Có      | Có      | Connection information của đúng Supabase project. | App đọc/ghi nhầm database hoặc health check thất bại.         |
| `DIRECT_DATABASE_URL` | Kết nối trực tiếp cho Drizzle schema/migration.               | Có   | Có      | Có      | Direct connection của cùng Supabase project.      | Migration có thể chạy vào database khác với database của app. |

Hai URL trong một env file phải trỏ tới cùng một môi trường. Với staging, cả hai
đều thuộc staging Supabase. Không bao giờ ghép `DATABASE_URL` staging với
`DIRECT_DATABASE_URL` production. `db:migrate:*` dùng direct URL; app và DB
integration tests dùng runtime URL.

### D. Supabase

| Variable                               | Mục đích                                            | Prod | Staging | Secret? | Lấy/tạo ở đâu                            | Cấu hình sai                                                              |
| -------------------------------------- | --------------------------------------------------- | ---- | ------- | ------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Public project URL cho browser/server Auth.         | Có   | Có      | Không   | Cấu hình project Supabase tương ứng.     | Auth/Storage/client kết nối sai project.                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client key được thiết kế để xuất hiện ở browser.    | Có   | Có      | Không   | Public client configuration của project. | Login/API client thất bại; không được coi việc giấu key là authorization. |
| `SUPABASE_SERVICE_ROLE_KEY`            | Credential đặc quyền cho server và private Storage. | Có   | Có      | Có      | Server credential của đúng project.      | Rò quyền cao hoặc server thao tác nhầm project.                           |
| `SUPABASE_STORAGE_BUCKET`              | Tên private bucket chứa draft media.                | Có   | Có      | Không   | Operator tạo/configure trong project.    | Upload, signed URL hoặc cleanup thất bại.                                 |

Production và staging có thể dùng cùng tên bucket, ví dụ `post-assets`, vì bucket
nằm trong hai Supabase project khác nhau. Tuyệt đối không prefix service-role key
bằng `NEXT_PUBLIC_`, không commit và không gửi xuống browser.

Google OAuth Client ID/Client Secret hiện không phải application env variables.
Ứng dụng không đọc `GOOGLE_CLIENT_ID` hoặc `GOOGLE_CLIENT_SECRET`; operator cấu
hình Google provider trong Supabase Auth và cấu hình redirect/origin ở Google và
Supabase. Không tự thêm hai biến này vào `.env.local`/`.env.staging`.

### E. Meta / Facebook

| Variable                             | Mục đích                                                 | Prod                     | Staging | Secret? | Lấy/tạo ở đâu                           | Cấu hình sai                                                 |
| ------------------------------------ | -------------------------------------------------------- | ------------------------ | ------- | ------- | --------------------------------------- | ------------------------------------------------------------ |
| `FACEBOOK_APP_ID`                    | Nhận diện Meta App cho Page-management/token inspection. | Có                       | Có      | Không   | Meta App được cấp cho môi trường.       | Page verify/sync hoặc token inspection thất bại.             |
| `FACEBOOK_APP_SECRET`                | Xác thực Meta App khi inspect token.                     | Có                       | Có      | Có      | Secret của Meta App.                    | Token inspection thất bại hoặc secret bị lộ.                 |
| `FACEBOOK_GRAPH_API_VERSION`         | Pin version trong mọi Graph request.                     | Có                       | Có      | Không   | Theo version được repo hỗ trợ.          | Contract API không đúng; staging guard từ chối version khác. |
| `FACEBOOK_USER_ACCESS_TOKEN`         | Runtime credential để discover/verify/sync Page.         | Có                       | Có      | Có      | Flow ủy quyền Meta của user phù hợp.    | Không quản lý/refresh danh sách Page được.                   |
| `FACEBOOK_CAPABILITY_TEST_PAGE_ID`   | Khóa smoke tool vào Page test chỉ định.                  | Không cho normal runtime | Có      | Không   | ID của non-production Page đã xác nhận. | Smoke bị từ chối hoặc có nguy cơ nhắm Page sai.              |
| `FACEBOOK_CAPABILITY_TEST_PAGE_NAME` | Đối chiếu tên Page test cùng với ID.                     | Không cho normal runtime | Có      | Không   | Tên chính xác của cùng Page test.       | Guard fail closed; không có `--force` bypass.                |

Version hiện được staging validator pin là `v26.0`. User Access Token không chỉ là
test token: các route Page sync, Page add/check và Facebook status dùng nó ở
runtime. Khi Page được sync/verify, Page Access Token được mã hóa AES-256-GCM trước
khi lưu database. Các mutation/read bình thường giải mã stored Page credential
chỉ tại Meta adapter boundary; chúng không dùng User Access Token thay thế.

Capability variables chỉ được trỏ đến designated non-production Page. Không dùng
Page production cho capability smoke và không copy Page credential giữa database.

### F. Mã hóa Page credential

| Variable                         | Mục đích                                          | Prod     | Staging  | Secret? | Lấy/tạo ở đâu                                | Cấu hình sai                                                |
| -------------------------------- | ------------------------------------------------- | -------- | -------- | ------- | -------------------------------------------- | ----------------------------------------------------------- |
| `TOKEN_ENCRYPTION_KEY`           | Current key mã hóa/giải mã stored Page token.     | Có       | Có       | Có      | Tạo bằng cryptographic RNG, 32 byte, Base64. | App không giải mã credential hoặc không khởi tạo keyring.   |
| `TOKEN_ENCRYPTION_KEY_VERSION`   | Version gắn với current key và ciphertext mới.    | Có       | Có       | Không   | Số nguyên dương do operator quản lý.         | Unknown/duplicate version làm credential fail closed.       |
| `TOKEN_ENCRYPTION_PREVIOUS_KEYS` | JSON map các old version sang old key khi rotate. | Tùy chọn | Tùy chọn | Có      | Secret history chỉ trong rotation window.    | Thiếu đúng old key khiến old credential không giải mã được. |

Key phải là random 32 byte rồi encode Base64; không dùng password, UUID hoặc ví dụ
trong tài liệu làm key. Fresh installation thường bắt đầu ở configured version
hiện tại, thông thường `1`. Fresh staging thường để previous-key map rỗng. Chỉ thêm
old key/version khi controlled rotation cần đọc credential cũ; không tự bịa key.

Staging phải tạo key riêng, không copy current hoặc previous production keys. Quy
trình đổi key đầy đủ nằm tại
[Credential rotation and recovery](runbooks/credential-rotation-and-recovery.md).

### G. Cron và machine security

| Variable                          | Mục đích                                                                   | Prod     | Staging             | Secret? | Lấy/tạo ở đâu                        | Cấu hình sai                                                   |
| --------------------------------- | -------------------------------------------------------------------------- | -------- | ------------------- | ------- | ------------------------------------ | -------------------------------------------------------------- |
| `APP_ACCESS_SECRET`               | Optional machine/break-glass access qua header riêng.                      | Tùy chọn | Tùy chọn            | Có      | Secret manager/cryptographic RNG.    | Bị lộ sẽ mở thêm machine-auth path; để trống thì path này tắt. |
| `ASSET_CLEANUP_SECRET`            | Bearer secret riêng cho asset-cleanup endpoint.                            | Có       | Có                  | Có      | Tạo random tối thiểu 32 ký tự.       | Cleanup bị 401 hoặc runtime từ chối secret ngắn.               |
| `FACEBOOK_CRON_SECRET`            | Bearer secret riêng cho sync/reconciliation cron.                          | Có       | Có                  | Có      | Tạo random tối thiểu 32 ký tự.       | Facebook cron bị 401 hoặc runtime từ chối secret ngắn.         |
| `CLOUDFLARE_ACCESS_CLIENT_ID`     | Credential của Cloudflare Access Service Token cho `staging:access-smoke`. | Không    | Chỉ access smoke/CI | Có      | Cloudflare Zero Trust Service Token. | Smoke không qua được infrastructure gateway.                   |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | Secret cùng cặp Service Token; phải rotate nếu lộ.                         | Không    | Chỉ access smoke/CI | Có      | Cloudflare Zero Trust Service Token. | Smoke bị từ chối hoặc credential bị lộ.                        |

Hai cron secret phải khác nhau. Staging tạo bộ riêng, không reuse production và
không dùng chung một giá trị cho hai job. `APP_ACCESS_SECRET` không bắt buộc: khi
trống, request vẫn phải đi qua Google session và policy hiện có.

Hai biến Cloudflare không phải browser/public config và không phải dependency của
normal application runtime, DB tooling, Storage hay Meta capability smoke. Chúng
không có tiền tố `NEXT_PUBLIC_` và chỉ được `staging:access-smoke` yêu cầu. Cả Client
ID và Client Secret đều được coi là sensitive vì dùng cùng nhau sẽ vượt qua lớp
Cloudflare Access; không commit, log hoặc đưa chúng vào evidence.

Mô hình request staging cuối cùng:

```text
Human:
Internet -> Cloudflare Access human authentication
         -> Content OS authentication -> application

Smoke/CI:
staging:access-smoke -> Cloudflare Access Service Token
                     -> Content OS unauthenticated smoke requests
                     -> expected 200/307/401/404 responses
```

Cloudflare Access authentication không thay thế Content OS authentication. Service
Token chỉ vượt qua infrastructure gateway; smoke cố ý không gửi application cookie,
session, cron secret hay application access secret.

`.env.staging` được Git ignore và hiện giữ Service Token để operator chạy smoke thuận
tiện. Vì Compose cũng dùng file này, credential có thể được cấp cho staging container
dù app không cần. Đây là tradeoff vận hành hiện tại; về sau nên chuyển cặp token sang
ops/CI secret source riêng để giảm quyền, nhưng task này không thay đổi kiến trúc secret
file.

### H. Admin và logging

| Variable              | Mục đích                                               | Prod             | Staging  | Secret?                         | Lấy/tạo ở đâu                  | Cấu hình sai                                              |
| --------------------- | ------------------------------------------------------ | ---------------- | -------- | ------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `INITIAL_ADMIN_EMAIL` | Nhận diện account được bảo vệ làm initial Super Admin. | Có khi bootstrap | Có       | Không, nhưng là dữ liệu cá nhân | Email operator được phê duyệt. | Không bootstrap/không bảo vệ đúng Super Admin mong muốn.  |
| `LOG_LEVEL`           | Mức log Pino; mặc định `info`.                         | Tùy chọn         | Tùy chọn | Không                           | Operator chọn theo nhu cầu.    | Giá trị Pino không hợp lệ có thể làm app không khởi động. |

`INITIAL_ADMIN_EMAIL` không phải password. Role và allowlist của production/staging
nằm trong hai database riêng. Không đưa email thật vào template hoặc evidence.
Các mức Pino thường dùng là `trace`, `debug`, `info`, `warn`, `error`, `fatal`;
production thông thường giữ `info` trừ khi đang điều tra có kiểm soát.

### I. AI đang deferred

| Variable              | Mục đích                                  | Prod  | Staging       | Secret? | Lấy/tạo ở đâu | Cấu hình sai                                        |
| --------------------- | ----------------------------------------- | ----- | ------------- | ------- | ------------- | --------------------------------------------------- |
| `AI_PROVIDER_API_KEY` | Reserved cho AI provider trong tương lai. | Không | Phải để trống | Có      | Chưa tạo.     | Staging readiness hiện từ chối nếu biến có giá trị. |

AI chưa được triển khai. Giữ `AI_PROVIDER_API_KEY=` trống; không cấp secret “để
dành”.

## Biến vận hành đặc biệt không đặt trong env file thường

Các tên sau xuất hiện trong scripts nhưng cố ý không nằm trong `.env.example`:

| Variable                                                     | Phạm vi                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `STAGING_SOURCE_DATABASE_URL`                                | Temporary source URL chỉ dùng trong isolated restore drill.              |
| `ISOLATED_RESTORE_DATABASE_URL`                              | Temporary isolated target URL cho restore verification.                  |
| `CONFIRM_ISOLATED_RESTORE_TARGET`                            | Confirmation marker bắt buộc của restore verifier.                       |
| `DATABASE_VERIFICATION_EXPLICIT_ENV`                         | Internal child-process guard của restore verifier.                       |
| `HAN_CONTENT_EXPLICIT_ENV` / `HAN_CONTENT_EXPLICIT_ENV_FILE` | Internal markers do env runner tự đặt.                                   |
| `__NEXT_PROCESSED_ENV`                                       | Internal marker chặn Next.js nạp env lần hai.                            |
| `NODE_ENV`                                                   | Do Next.js/Docker/test runner quản lý; không phải identity prod/staging. |

Không lưu database restore URLs trong `.env.local` hoặc `.env.staging`. Làm theo
[staging deployment runbook](runbooks/staging-deployment.md) để pin verification
vào isolated target.

## Lấy từng nhóm giá trị ở đâu?

### Docker và local configuration

- Operator đặt `HAN_CONTENT_*`, `DEPLOYMENT_ENVIRONMENT`, public URLs,
  `FACEBOOK_CRON_BASE_URL` và `LOG_LEVEL` theo topology trong tài liệu này.
- Kiểm tra production Compose project đang chạy trước khi đổi tên project.

### Supabase của đúng môi trường

- Lấy project URL, publishable client key và privileged server key từ cấu hình
  project tương ứng.
- Lấy pooled/runtime connection cho `DATABASE_URL` và direct connection cho
  `DIRECT_DATABASE_URL`; xác nhận cả hai thuộc cùng project.
- Tạo/configure private Storage bucket trong chính project đó.
- Cấu hình Google provider và callback/origin tại Supabase/Google, không tạo app
  env variables cho Google credentials.

### Meta

- Lấy App ID/App Secret từ Meta App được dùng cho môi trường.
- Tạo/ủy quyền User Access Token bằng account và scopes đã phê duyệt.
- Xác nhận ID và tên designated non-production Page trước khi cấu hình capability
  smoke.

### Tạo cục bộ rồi lưu vào secret manager

- Tạo `TOKEN_ENCRYPTION_KEY` bằng cryptographic RNG 32 byte rồi Base64.
- Tạo riêng `ASSET_CLEANUP_SECRET`, `FACEBOOK_CRON_SECRET` và optional
  `APP_ACCESS_SECRET` bằng cryptographic RNG.
- Không đưa secret lên command line, clipboard history, source control hoặc
  evidence.

### Cloudflare Zero Trust

- Tạo Service Token chỉ dành cho staging smoke trong Cloudflare Zero Trust.
- Policy `Service Auth` chỉ cho token đó truy cập hostname staging; không tạo broad
  bypass policy.
- Lưu cả Client ID và Client Secret trong approved local/CI secret source. Rotate
  cả cặp theo quy trình Cloudflare nếu một giá trị bị lộ.

### Operator identity

- Chọn account email được phê duyệt cho `INITIAL_ADMIN_EMAIL`; production và
  staging có authorization rows độc lập.

## Skeleton production an toàn

Installation production đang tồn tại nên giữ Compose project identity hiện tại.
Skeleton dưới đây dùng identity lịch sử; chỉ dùng `han-content-os-prod` cho
installation mới hoặc controlled cutover.

```dotenv
HAN_CONTENT_COMPOSE_PROJECT=han-content-os
HAN_CONTENT_IMAGE=han-content-os:prod
HAN_CONTENT_ENV_FILE=.env.local
HAN_CONTENT_PORT=3210
DEPLOYMENT_ENVIRONMENT=
STAGING_BASE_URL=
CLOUDFLARE_ACCESS_CLIENT_ID=
CLOUDFLARE_ACCESS_CLIENT_SECRET=
NEXT_PUBLIC_SITE_URL=https://social.vutiendung.io.vn
FACEBOOK_CRON_BASE_URL=http://app:3000

DATABASE_URL=
DIRECT_DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=post-assets

FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_GRAPH_API_VERSION=v26.0
FACEBOOK_USER_ACCESS_TOKEN=
FACEBOOK_CAPABILITY_TEST_PAGE_ID=
FACEBOOK_CAPABILITY_TEST_PAGE_NAME=

TOKEN_ENCRYPTION_KEY=
TOKEN_ENCRYPTION_KEY_VERSION=1
TOKEN_ENCRYPTION_PREVIOUS_KEYS=
APP_ACCESS_SECRET=
ASSET_CLEANUP_SECRET=
FACEBOOK_CRON_SECRET=
INITIAL_ADMIN_EMAIL=
LOG_LEVEL=info
AI_PROVIDER_API_KEY=
```

## Skeleton staging an toàn

Các giá trị identity/public dưới đây là non-secret và phải khớp validator. Mọi
credential vẫn để trống để operator lấy từ staging providers/secret manager.

```dotenv
HAN_CONTENT_COMPOSE_PROJECT=han-content-os-staging
HAN_CONTENT_IMAGE=han-content-os:staging
HAN_CONTENT_ENV_FILE=.env.staging
HAN_CONTENT_PORT=3211
DEPLOYMENT_ENVIRONMENT=staging
STAGING_BASE_URL=https://staging-social.vutiendung.io.vn
CLOUDFLARE_ACCESS_CLIENT_ID=
CLOUDFLARE_ACCESS_CLIENT_SECRET=
NEXT_PUBLIC_SITE_URL=https://staging-social.vutiendung.io.vn
FACEBOOK_CRON_BASE_URL=http://app:3000

DATABASE_URL=
DIRECT_DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=post-assets

FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_GRAPH_API_VERSION=v26.0
FACEBOOK_USER_ACCESS_TOKEN=
FACEBOOK_CAPABILITY_TEST_PAGE_ID=
FACEBOOK_CAPABILITY_TEST_PAGE_NAME=

TOKEN_ENCRYPTION_KEY=
TOKEN_ENCRYPTION_KEY_VERSION=1
TOKEN_ENCRYPTION_PREVIOUS_KEYS=
APP_ACCESS_SECRET=
ASSET_CLEANUP_SECRET=
FACEBOOK_CRON_SECRET=
INITIAL_ADMIN_EMAIL=
LOG_LEVEL=info
AI_PROVIDER_API_KEY=
```

## Không copy giữa hai môi trường

| Phải độc lập ở staging                                                                                           | Lý do                                                    |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`, `DIRECT_DATABASE_URL`                                                                            | Ngăn app/migration chạm production database.             |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                               | Browser/Auth phải thuộc staging project.                 |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                                      | Không cấp quyền production cho staging server.           |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_USER_ACCESS_TOKEN`, stored Page credentials, capability Page | Staging chỉ dùng Meta resources/Page test được chỉ định. |
| `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_PREVIOUS_KEYS`                                                         | Không đưa production key material vào staging.           |
| `ASSET_CLEANUP_SECRET`, `FACEBOOK_CRON_SECRET`                                                                   | Không cho staging machine gọi production endpoints.      |
| `APP_ACCESS_SECRET` khi bật                                                                                      | Không dùng chung break-glass/machine credential.         |

Các giá trị structural cũng cố ý khác: `HAN_CONTENT_COMPOSE_PROJECT`,
`HAN_CONTENT_IMAGE`, `HAN_CONTENT_ENV_FILE`, `HAN_CONTENT_PORT` và
`NEXT_PUBLIC_SITE_URL`. Bucket name, Graph version, key version hoặc log level có
thể giống về mặt chữ, nhưng vẫn phải được operator xác nhận trong đúng env file.

## Lỗi cấu hình thường gặp

- Copy staging database URL từ production, hoặc trỏ `DIRECT_DATABASE_URL` vào
  production trong khi `DATABASE_URL` là staging.
- Bỏ thiếu biến trong `.env.staging` rồi kỳ vọng runner tự lấy từ `.env.local`.
- Dùng chung một image tag, khiến bundle `NEXT_PUBLIC_*` của môi trường này được
  serve ở môi trường kia.
- Đổi tên Compose project production đang chạy mà không controlled cutover, tạo
  project thứ hai và xung đột port `3210`.
- Prefix service-role/server secret bằng `NEXT_PUBLIC_`, làm secret có nguy cơ vào
  client bundle.
- Thêm Google OAuth secret vào app env dù source code không đọc biến đó.
- Chọn production Facebook Page làm capability-test Page.
- Reuse production encryption, cron hoặc machine secret trong staging.
- Cấp `AI_PROVIDER_API_KEY` trong khi staging validator yêu cầu AI để trống.
- Commit `.env.local`, `.env.staging`, database URL, key hoặc token.

## Trình tự setup staging bình thường

Chỉ chạy khi `.env.staging` đã được operator điền và xác nhận thuộc staging. Tài
liệu này không tự chạy các command sau:

1. Tạo/điền `.env.staging` bằng giá trị staging độc lập.
2. `corepack pnpm staging:env-check`
3. `corepack pnpm db:ping:staging`
4. `corepack pnpm db:check:staging`
5. Tạo/xác minh staging backup checkpoint khi áp dụng.
6. `corepack pnpm db:migrate:staging`
7. `corepack pnpm db:verify:staging`
8. `corepack pnpm test:db:staging`
9. `corepack pnpm storage:configure:staging`
10. `docker compose --env-file .env.staging config --quiet`
11. `docker compose --env-file .env.staging up -d --build`
12. Kiểm tra `http://127.0.0.1:3211/api/health`.
13. Xác minh staging domain, gateway và Google login.
14. Tiếp tục [staging deployment runbook](runbooks/staging-deployment.md).
