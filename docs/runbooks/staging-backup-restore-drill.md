# Runbook backup và restore database staging

Tài liệu này hướng dẫn operator thực hiện một drill PostgreSQL/Supabase trên
**staging** bằng Windows PowerShell. Workflow portable `pg_dump`/`pg_restore` là
quy trình chuẩn. Backup do nhà cung cấp quản lý chỉ là lựa chọn bổ sung khi gói dịch
vụ thực tế có hỗ trợ; runbook không giả định tính năng, tên nút hoặc entitlement của
Supabase.

## 1. Mục tiêu của backup + restore drill

Có file backup chưa đủ chứng minh khả năng phục hồi. Drill chỉ có ý nghĩa khi chứng
minh đủ bốn việc:

1. tạo được backup;
2. đọc được archive;
3. restore được archive;
4. schema và data sau restore dùng được với code hiện tại.

Đây chỉ là drill **STAGING**. Không restore vào production, không ghi đè database
staging đang chạy. Target phải là database tạm thời và cô lập.

```text
Current staging DB
      |
      v
backup file
      |
      v
isolated restore target
      |
      v
staging:restore-verify
      |
      v
PASS
      |
      v
cleanup temporary target
```

## 2. Safety rules trước khi chạm vào database

> [!WARNING]
>
> - Không bao giờ dùng production `DATABASE_URL` hoặc `DIRECT_DATABASE_URL`.
> - Không restore vào production hoặc database staging hiện tại.
> - Không bao giờ chạy `pg_restore --clean` với production hoặc staging hiện tại.
> - Không đưa URL/password database vào Git, issue, docs, screenshot, command-line
>   argument, chat, CI log hoặc evidence.
> - Không commit backup và không đặt backup bên trong repository.
> - Không copy Page credential, encryption key, service-role secret hoặc secret
>   production vào restore target.
> - Trước dump và restore, operator phải đối chiếu trực quan project nguồn/đích tại
>   provider console. Nếu có dấu hiệu source và target là cùng database, dừng ngay.

Restore verifier yêu cầu URL nguồn và URL target riêng. Nó từ chối khi hai URL có
cùng hostname, effective port và database path, kể cả username/password khác nhau.
Guard này chặn trường hợp phổ biến là vô tình chọn lại source. Nó không thể nhận ra
hai hostname alias hoặc pooler khác nhau cùng trỏ tới một database vật lý, nên kiểm
tra trực quan của operator vẫn bắt buộc.

## 3. Prerequisites

- Windows PowerShell.
- Dependencies của repository đã được cài bằng pnpm.
- PostgreSQL client tools tương thích với server: `pg_dump`, `pg_restore`; `psql`
  chỉ cần cho manual checks tùy chọn.
- Quyền đọc connection details của staging.
- Quyền tạo và xóa một PostgreSQL database/project tạm thời, cô lập.
- Đủ dung lượng đĩa ngoài repository cho archive.
- Checkout hiện tại đúng commit cần xác minh.

Archive có thể chứa dữ liệu staging nhạy cảm dù token đang ở dạng mã hóa. Giới hạn
quyền đọc thư mục backup và xử lý file theo retention policy đã phê duyệt.

Kiểm tra tools mà không làm lộ password:

```powershell
pg_dump --version
pg_restore --version
```

Không dùng `corepack pnpm staging:restore-verify --help`. Script hiện không parse
hoặc hỗ trợ help flag; gọi nó sẽ đi vào flow verification thật và fail closed nếu
thiếu guard.

## 4. Chọn chiến lược restore target

### A. Supabase project/database tạm thời riêng

Đây là lựa chọn ưu tiên khi thực tế cho phép. Có thể đặt logical name như
`content-os-staging-restore-test`.

- Project/database identity phải khác production và staging hiện tại.
- Không cấu hình production OAuth, Meta token, Cloudflare, cron hoặc runtime traffic.
- Chỉ cần PostgreSQL connectivity tương thích để restore và verify.
- Giao diện provider có thể thay đổi; dùng chức năng tạo database/project tạm thời
  đang có, không giả định một plan cụ thể hỗ trợ managed restore.

### B. PostgreSQL target cô lập khác

Được phép nếu version/extensions/permissions tương thích. “Cô lập” nghĩa là target
không phải production hoặc staging hiện tại, không có application/cron writer, không
được public routing tới, có credential riêng và có thể xóa an toàn sau drill.

## 5. Ghi safe identifiers trước khi bắt đầu

Chỉ ghi:

- ngày/giờ;
- Git commit SHA;
- environment = `staging`;
- logical name nguồn, ví dụ `content-os-staging`;
- logical name restore target;
- tên file backup;
- PASS/FAIL.

Không ghi password, connection URL, username, service-role key, encryption key,
Facebook token hoặc nội dung ciphertext.

```powershell
git rev-parse HEAD
git status --short
```

Nếu working tree không sạch, ghi nhận trạng thái và xác nhận checkout vẫn đúng code
cần verify. Không đưa nội dung secret file vào evidence.

<a id="buoc-6"></a>

## 6. Cấu hình source connection an toàn trong PowerShell

Mở một PowerShell session dành riêng cho drill. Điền connection của **staging
source**, dùng placeholder dưới đây để hiểu cấu trúc, không copy placeholder vào
evidence:

```powershell
$env:PGHOST="<staging-host>"
$env:PGPORT="<staging-port>"
$env:PGDATABASE="<staging-database>"
$env:PGUSER="<staging-user>"
$env:PGPASSWORD="<staging-password>"
$env:STAGING_SOURCE_DATABASE_URL="<postgresql-uri-cua-staging-source>"
$env:DEPLOYMENT_ENVIRONMENT="staging"
```

Trong session thật, nên nhập password và URL qua prompt che input để giá trị không
nằm trong command history:

```powershell
$pgPasswordInput = Read-Host "Staging database password" -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new("", $pgPasswordInput).Password
Remove-Variable pgPasswordInput

$sourceUrlInput = Read-Host "Staging source PostgreSQL URL" -AsSecureString
$env:STAGING_SOURCE_DATABASE_URL = [System.Net.NetworkCredential]::new("", $sourceUrlInput).Password
Remove-Variable sourceUrlInput
```

Không chạy `echo $env:PGPASSWORD`, không in URL và không truyền URL trên command
line. `PGPASSWORD` dùng password thô. Trong PostgreSQL URI, username/password có ký
tự reserved phải được percent-encode; ưu tiên dùng URI do provider cung cấp và nhập
qua prompt che input thay vì tự ghép.

Trước khi tiếp tục, đối chiếu trực quan:

- project là staging;
- host và database name đúng staging;
- không phải production;
- không phải restore target;
- `STAGING_SOURCE_DATABASE_URL` mô tả đúng cùng source mà bộ `PG*` đang trỏ tới.

<a id="buoc-7"></a>

## 7. Tạo backup

Backup phải ở ngoài repository. Ví dụ tạo thư mục riêng:

```powershell
New-Item -ItemType Directory -Force C:\content-os-backups | Out-Null
```

Tạo archive custom format:

```powershell
pg_dump `
  --format=custom `
  --no-owner `
  --no-privileges `
  --file="C:\content-os-backups\content-os-staging-restore-drill.dump"

if ($LASTEXITCODE -ne 0) { throw "STAGING_BACKUP_FAILED" }
```

Custom format hỗ trợ `pg_restore --list`, selective restore tooling và restore có
kiểm soát. Command không chứa URL; `pg_dump` đọc connection từ `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, `PGPASSWORD`. Bất kỳ exit code khác `0` phải dừng drill.

<a id="buoc-8"></a>

## 8. Xác minh backup đọc được trước khi restore

```powershell
pg_restore --list "C:\content-os-backups\content-os-staging-restore-drill.dump"
if ($LASTEXITCODE -ne 0) { throw "STAGING_BACKUP_ARCHIVE_UNREADABLE" }
```

Thành công nghĩa là `pg_restore` đọc được catalog của archive; chưa có nghĩa data đã
restore thành công. Không copy toàn bộ object list vào evidence. Evidence an toàn:
`backup archive readable: PASS`.

Có thể kiểm tra metadata file:

```powershell
Get-Item "C:\content-os-backups\content-os-staging-restore-drill.dump" |
  Select-Object Name,Length,LastWriteTime
```

<a id="buoc-9"></a>

## 9. Tạo isolated restore target

Checklist bắt buộc:

- [ ] Target mới/tạm thời.
- [ ] Không phải production.
- [ ] Không phải staging hiện tại.
- [ ] Không app container nào trỏ vào target.
- [ ] Không Cloudflare route nào trỏ vào target.
- [ ] Không cron nào chạy với target.
- [ ] Không copy production secret vào target.
- [ ] Chỉ cấp PostgreSQL connectivity cần cho drill.

Không clone toàn bộ production settings. Nếu dùng provider-managed target, tên
screen/button có thể thay đổi; điều quan trọng là database identity và isolation.

<a id="buoc-10"></a>

## 10. Chuyển PG variables từ source sang target

Sau khi dump đã thành công, đổi toàn bộ `PG*` sang **restore target**:

```powershell
$env:PGHOST="<restore-target-host>"
$env:PGPORT="<restore-target-port>"
$env:PGDATABASE="<restore-target-database>"
$env:PGUSER="<restore-target-user>"
$env:PGPASSWORD="<restore-target-password>"
```

Với password, dùng lại `Read-Host -AsSecureString` như [bước 6](#buoc-6). Sau đó
nhập target URL qua prompt che input và đặt confirmation chính xác:

```powershell
$targetUrlInput = Read-Host "Isolated restore PostgreSQL URL" -AsSecureString
$env:ISOLATED_RESTORE_DATABASE_URL = [System.Net.NetworkCredential]::new("", $targetUrlInput).Password
Remove-Variable targetUrlInput

$env:CONFIRM_ISOLATED_RESTORE_TARGET="isolated-staging-restore"
```

Phân biệt ba nhóm:

```text
STAGING_SOURCE_DATABASE_URL
  -> original staging DB

ISOLATED_RESTORE_DATABASE_URL
  -> temporary restore DB

PG*
  -> currently point to restore target during restore
```

> [!CAUTION]
> Nếu source và target có cùng host/port/database, **STOP**. Cũng dừng nếu `PG*`
> không mô tả cùng target với `ISOLATED_RESTORE_DATABASE_URL`. Repository guard so
> hai URL source/target; nó không tự so bộ `PG*` dùng bởi `pg_restore`.

<a id="buoc-11"></a>

## 11. Restore backup

Chỉ chạy trên target disposable đã xác minh:

```powershell
pg_restore `
  --clean `
  --if-exists `
  --no-owner `
  --no-privileges `
  --dbname=$env:PGDATABASE `
  "C:\content-os-backups\content-os-staging-restore-drill.dump"

if ($LASTEXITCODE -ne 0) { throw "STAGING_RESTORE_FAILED" }
```

`pg_restore` lấy host/port/user/password từ `PG*`; `--dbname` ở đây chỉ truyền tên
database target. `--clean` xóa object trước khi tạo lại và vì vậy cực kỳ nguy hiểm:
chỉ được phép trên target tạm thời, cô lập. `--if-exists` giảm noise khi target mới
chưa có object. Notice về object chưa tồn tại có thể vô hại nếu exit code vẫn `0`,
nhưng warning về permission/extension hoặc dòng `errors ignored on restore` phải được
review; exit code khác `0` luôn là FAIL, không được normalize thành PASS.

<a id="buoc-12"></a>

## 12. Chạy repository restore verification

Xác nhận trong cùng PowerShell session đã có:

- `DEPLOYMENT_ENVIRONMENT=staging`;
- `CONFIRM_ISOLATED_RESTORE_TARGET=isolated-staging-restore`;
- `STAGING_SOURCE_DATABASE_URL` là original staging source;
- `ISOLATED_RESTORE_DATABASE_URL` là temporary target.

Sau đó chạy:

```powershell
corepack pnpm staging:restore-verify
```

Theo implementation hiện tại, command:

1. fail closed nếu environment marker, confirmation hoặc một URL bị thiếu/sai;
2. từ chối source/target cùng hostname + effective port + database path;
3. ghi đè `DIRECT_DATABASE_URL` và `DATABASE_URL` của child process bằng target URL;
4. bật `DATABASE_VERIFICATION_EXPLICIT_ENV=true`, nên schema verifier không load
   `.env.local`;
5. chạy `scripts/verify-database-schema.mjs` để enforce danh sách table mong đợi,
   không có table lạ và cấu trúc columns/primary key/foreign key/index của
   `mutation_rate_limits`; script cũng report legacy tables cùng tổng foreign/check
   constraints nhưng không dùng riêng các tổng đó làm điều kiện PASS;
6. chạy trực tiếp hai suites
   `src/db/repositories/repositories.integration.test.ts` và
   `src/db/repositories/cron-job-repository.integration.test.ts` với target URL.

Integration suites thực hiện read/write có cleanup hoặc transaction rollback, vì vậy
chỉ chạy trên target disposable. Command không gọi package script `test:db` vốn chọn
`.env.local`. Bất kỳ child command nào trả non-zero làm verifier trả non-zero. Stable
success cuối cùng hiện là:

```json
{ "ok": true, "event": "isolated_restore_verification_passed" }
```

Failure chỉ nên được ghi bằng safe event/code và variable names; không copy URL hoặc
credential vào evidence.

<a id="buoc-13"></a>

## 13. Manual verification bổ sung

Schema verifier đã kiểm tra tables/constraints chính, nên không cần lặp lại object
list bằng raw SQL. Sau khi nó pass, có thể dùng `psql` với bộ `PG*` vẫn trỏ target để
kiểm tra aggregate an toàn:

```powershell
psql --no-psqlrc --set=ON_ERROR_STOP=1 --command `
  "select count(*) as page_count from hancontent_os.pages;"
if ($LASTEXITCODE -ne 0) { throw "SAFE_DATA_CHECK_FAILED" }
```

Không query caption, remote metadata hoặc token fields. Với Page credentials, chỉ
đếm row sai cấu trúc, không select ciphertext/nonce/auth tag/fingerprint:

```powershell
psql --no-psqlrc --set=ON_ERROR_STOP=1 --command @"
select count(*) as invalid_credential_rows
from hancontent_os.page_credentials
where octet_length(access_token_ciphertext) = 0
   or octet_length(nonce) = 0
   or octet_length(auth_tag) = 0
   or key_version <= 0
   or btrim(token_fingerprint) = '';
"@
if ($LASTEXITCODE -ne 0) { throw "CREDENTIAL_STRUCTURE_CHECK_FAILED" }
```

Kết quả hợp lệ là `invalid_credential_rows = 0`. Không in plaintext token,
ciphertext, nonce, auth tag, fingerprint hoặc encryption key. Nếu không có `psql`,
ghi manual aggregate check là chưa thực hiện; không tự suy diễn PASS.

## 14. Định nghĩa PASS

Drill chỉ PASS khi tất cả mục áp dụng đều thành công:

- [ ] Source được xác nhận là staging.
- [ ] Target được xác nhận cô lập.
- [ ] `pg_dump` exit `0`.
- [ ] `pg_restore --list` exit `0`.
- [ ] `pg_restore` vào target exit `0`.
- [ ] `corepack pnpm staging:restore-verify` exit `0`.
- [ ] Safe count/structural validation thành công.
- [ ] Không secret nào bị in, stage hoặc commit.
- [ ] Restore target không phục vụ application traffic.

Documentation hoặc automated mock test không thay thế drill thật.

## 15. Failure handling

| Problem                                  | Ý nghĩa                                                                        | Safe action                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `pg_dump` authentication failure         | Source credential/role không hợp lệ.                                           | Dừng; xác minh lại staging identity và credential trong provider console. Không thử production URL.            |
| `pg_dump` connection timeout             | Network, allowlist, pooler/direct endpoint hoặc server không reachable.        | Dừng; kiểm tra connectivity tới staging source, không đổi sang production.                                     |
| Backup unreadable                        | Archive thiếu/hỏng hoặc client version không đọc được.                         | FAIL; tạo archive staging mới, không restore file đó.                                                          |
| `pg_restore` authentication failure      | Target credential/role không hợp lệ.                                           | Dừng; sửa quyền của isolated target, không đổi target thành staging hiện tại.                                  |
| Version incompatibility                  | PostgreSQL client/archive/server không tương thích.                            | Dùng client version tương thích và chạy lại từ source; không bỏ qua lỗi.                                       |
| Permission/ownership warnings            | Target role thiếu quyền hoặc dump chứa ownership/ACL/provider object đặc biệt. | Review từng warning; `--no-owner --no-privileges` đã giảm ACL noise. Non-zero là FAIL.                         |
| Extension-related restore problems       | Target thiếu extension hoặc operator không có quyền tạo extension.             | Chuẩn bị compatible isolated target/extension hợp lệ rồi restore lại; không bỏ object tùy tiện.                |
| `RESTORE_TARGET_MATCHES_SOURCE`          | Source và target URL có cùng host/port/database path.                          | Dừng ngay, tạo target thật sự khác và kiểm tra lại identity.                                                   |
| `DEPLOYMENT_ENVIRONMENT_NOT_STAGING`     | Session không được đánh dấu staging.                                           | Xác nhận lại toàn bộ source/target rồi đặt marker staging; không dùng production env file.                     |
| `ISOLATED_RESTORE_CONFIRMATION_REQUIRED` | Confirmation thiếu hoặc sai chính xác.                                         | Xác minh target trước, rồi đặt đúng marker; không bypass code.                                                 |
| Source/target URL missing hoặc invalid   | Một guard URL không có hoặc không phải PostgreSQL URI hợp lệ.                  | Nhập lại đúng URL qua prompt che input; không in URL để debug.                                                 |
| Schema verification fail                 | Restore thiếu/sai tables, constraints hoặc rate-limit schema.                  | Giữ target để điều tra, đánh FAIL; không chạy migration để che lỗi restore nếu mục tiêu là kiểm chứng archive. |
| DB integration tests fail                | Restored DB không tương thích với repository behavior hiện tại.                | Đánh FAIL, giữ logs không secret và điều tra code/schema/permission trên target.                               |

Quy tắc tối quan trọng: không “fix” drill bằng cách trỏ verifier về production hoặc
staging hiện tại.

<a id="buoc-16"></a>

## 16. Cleanup

Sau khi đã ghi safe result:

1. Xóa temporary restore target bằng quy trình provider đã được phê duyệt. Xác nhận
   logical name trước khi xóa; tuyệt đối không xóa staging/production.
2. Xóa archive theo retention policy. Nếu policy cho phép xóa ngay:

   ```powershell
   Remove-Item -LiteralPath "C:\content-os-backups\content-os-staging-restore-drill.dump"
   ```

3. Xóa secrets/guards khỏi PowerShell process:

   ```powershell
   Remove-Item Env:PGHOST -ErrorAction SilentlyContinue
   Remove-Item Env:PGPORT -ErrorAction SilentlyContinue
   Remove-Item Env:PGDATABASE -ErrorAction SilentlyContinue
   Remove-Item Env:PGUSER -ErrorAction SilentlyContinue
   Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
   Remove-Item Env:STAGING_SOURCE_DATABASE_URL -ErrorAction SilentlyContinue
   Remove-Item Env:ISOLATED_RESTORE_DATABASE_URL -ErrorAction SilentlyContinue
   Remove-Item Env:CONFIRM_ISOLATED_RESTORE_TARGET -ErrorAction SilentlyContinue
   Remove-Item Env:DEPLOYMENT_ENVIRONMENT -ErrorAction SilentlyContinue
   ```

4. Kiểm tra target đã biến mất, archive đã được xử lý đúng policy và các env names
   không còn trong session. Không in giá trị để kiểm tra.

Không xóa `.env.staging`. Đóng terminal loại bỏ process-level environment state,
nhưng không thay thế intentional cleanup check và cleanup target/archive.

## 17. Evidence template

Chỉ copy template metadata an toàn này:

```text
Staging backup/restore drill

Date:
Commit:
Source environment: staging
Restore target: isolated temporary PostgreSQL/Supabase database

Backup created: PASS/FAIL
Backup archive readable: PASS/FAIL
Restore completed: PASS/FAIL
staging:restore-verify: PASS/FAIL
Safe schema/data checks: PASS/FAIL
Secret exposure check: PASS/FAIL
Temporary target cleanup: PASS/FAIL

Overall: PASS/FAIL
Notes:
```

Không thêm hostname, database URL, username, secret hoặc Page token. Chỉ thêm thông
tin khác khi đã xác nhận rõ là non-sensitive và thực sự cần.

## 18. Quick checklist — lần sau chỉ cần làm theo đây

1. [Xác minh source staging và ghi safe identifiers](#buoc-6).
2. [Đặt source `PG*`, source URL và staging marker](#buoc-6).
3. [Dump ra archive ngoài repository](#buoc-7).
4. [Kiểm tra archive đọc được](#buoc-8).
5. [Tạo isolated restore target](#buoc-9).
6. [Chuyển `PG*` sang target](#buoc-10).
7. [Đặt target URL và confirmation guard](#buoc-10).
8. [Restore vào target](#buoc-11).
9. [Chạy `staging:restore-verify`](#buoc-12).
10. [Chạy safe checks và ghi PASS/FAIL evidence](#buoc-13).
11. [Xóa temporary target/archive theo policy](#buoc-16).
12. [Clear toàn bộ temporary environment variables](#buoc-16).

Nếu bất kỳ bước nào fail, dừng và xử lý theo [Failure handling](#15-failure-handling);
không chuyển target sang production hoặc staging hiện tại để làm cho command pass.
