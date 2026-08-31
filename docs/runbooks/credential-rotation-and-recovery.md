# Credential rotation and recovery runbook

Runbook này chỉ dành cho operator có quyền truy cập secret manager và database của đúng môi trường. Không đưa token hoặc encryption key vào ticket, chat, log, command-line argument hay Git.

## Page encryption-key rotation

### Chuẩn bị

1. Xác nhận backup/database restore point gần nhất và chọn cửa sổ bảo trì.
2. Ghi nhận version hiện tại, ví dụ `1`. Không ghi giá trị key.
3. Tạo key mới bằng nguồn random mật mã, 32 byte và encode Base64. Lưu trực tiếp vào secret manager.
4. Cấu hình môi trường với lifecycle sau:

```text
TOKEN_ENCRYPTION_KEY=<new version-2 key>
TOKEN_ENCRYPTION_KEY_VERSION=2
TOKEN_ENCRYPTION_PREVIOUS_KEYS={"1":"<old version-1 key>"}
```

5. Restart application. Giữ cả current và previous key cho đến khi hoàn tất toàn bộ verification.

### Dry-run bắt buộc

```powershell
corepack pnpm credentials:rotate-pages -- --from-version=1
```

Output phải hiển thị `sourceVersion: 1`, `targetVersion: 2`, `credentialCount` và `rotation_dry_run_succeeded`. Output không được chứa token/key. Nếu dry-run lỗi, dừng tại đây và làm theo phần rollback/recovery.

### Thực thi

Sau khi hai operator kiểm tra cấu hình và dry-run output:

```powershell
corepack pnpm credentials:rotate-pages -- --from-version=1 --execute --confirm-target-version=2
```

CLI luôn chạy dry-run lại trước ghi thật. Thành công cần có:

- `rotation_execution_succeeded`;
- `remainingSourceVersionCredentials: 0`;
- `rotation_verification_succeeded`.

Sau đó smoke-test Facebook read, publish/schedule trên Page test, và một mutation có readback. Không dùng Page production để tạo nội dung thử.

Chỉ xóa version `1` khỏi `TOKEN_ENCRYPTION_PREVIOUS_KEYS` sau khi:

1. CLI xác nhận không còn credential version `1`;
2. Facebook read và mutation smoke pass;
3. application logs không có `TOKEN_DECRYPTION_FAILED` hoặc `UNKNOWN_TOKEN_KEY_VERSION`.

Restart application lần cuối sau khi bỏ previous key.

## Rotation rollback/recovery

- Dry-run lỗi: chưa có row nào bị thay đổi. Khôi phục cấu hình current version/key trước đó nếu application không đọc được credential, restart, rồi điều tra ciphertext/key-version bị lỗi.
- Execution lỗi giữa batch: service dùng một database transaction nên batch bị rollback. Giữ cả old/new keys, chạy lại dry-run và không xóa previous key.
- CLI báo còn old-version row sau execution: có thể có concurrent credential sync. Giữ cả hai key, dừng secret cleanup, chạy lại dry-run rồi execute. Không sửa ciphertext thủ công.
- Đã đổi secret nhưng application lỗi: đặt lại old key làm current với đúng old version, vẫn giữ new key trong previous map nếu đã có row new version, restart và kiểm tra cả hai version trước thao tác tiếp.
- Không restore ciphertext riêng lẻ từ log hoặc copy plaintext token. Nếu record thực sự hỏng, lấy Page token mới qua flow verify/sync chính thức.

## Facebook user-token replacement

1. Tạo/re-authorize long-lived Facebook User Access Token bằng tài khoản/App được phê duyệt.
2. Kiểm tra App ID, owner và scopes bằng flow Page check; không paste token vào UI hoặc log.
3. Thay `FACEBOOK_USER_ACCESS_TOKEN` trong secret manager rồi restart.
4. Chạy Page sync bằng admin/machine-auth hiện có.
5. Xác nhận danh sách Page/scopes và Page test read thành công.
6. Chỉ revoke user token cũ sau khi sync và smoke test pass.

User-token replacement không tự động publish và không tự retry operation đang `uncertain`.

## Revoked, expired or permission-missing Page token

Meta code `190` được chuẩn hóa thành `FACEBOOK_TOKEN_INVALID`; code `10/200` thành `FACEBOOK_PERMISSION_DENIED`. Với lỗi xác định, hệ thống:

- đánh dấu operation `failed`, không blind retry;
- chuyển Page sang `revoked` hoặc `permission_missing`;
- lưu evidence đã sanitize trong `pages.remote_metadata.credentialIncident` gồm status, stable error code, operation ID và thời điểm;
- đặt `page_credentials.revoked_at` khi token bị invalid/revoked;
- chặn mutation tiếp theo bằng `PAGE_CREDENTIAL_MUTATION_LOCKED`.

Network timeout/5xx vẫn là `uncertain`, không khóa credential và không tự gửi mutation lần nữa; dùng reconciliation workflow.

Recovery:

1. Re-authorize token/scopes bên Meta.
2. Chạy manual Page verification hoặc managed Page sync.
3. Flow thành công sẽ upsert encrypted credential mới, xóa `revokedAt`, đặt Page lại `active` và thay incident metadata bằng metadata verification/sync mới.
4. Smoke-test read trước, sau đó mutation trên Page test.
5. Xác nhận operation cũ vẫn giữ evidence; không xóa hoặc đổi nó thành success nếu chưa đối soát remote.

## Decryption failure

Với `TOKEN_DECRYPTION_FAILED`:

1. Hệ thống chuyển Page sang credential `error` và khóa mutation; không thử key ngẫu nhiên và không sửa ciphertext.
2. So sánh stored `key_version` với current/previous version names trong secret manager, không in key value.
3. Nếu cấu hình sai, restore đúng key cho version đó và restart.
4. Chạy rotation dry-run; chỉ execute sau khi dry-run pass.
5. Nếu ciphertext/auth tag hỏng, lấy credential mới qua Page verify/sync. Giữ record/operation evidence để điều tra.

## Unknown key version

`UNKNOWN_TOKEN_KEY_VERSION` luôn fail closed, không fallback sang current key.

1. Hệ thống khóa mutation cho Page liên quan; xác nhận stored version và deployment secret history.
2. Bổ sung đúng key vào `TOKEN_ENCRYPTION_PREVIOUS_KEYS`, restart và chạy dry-run.
3. Nếu key version đó không thể phục hồi, re-authorize Page và persist credential mới; không brute-force hoặc thay version trực tiếp trong database.

## Staging drill

Thực hiện trước production:

1. Tạo staging old/new keys và ít nhất hai encrypted Page-test credentials ở old version.
2. Deploy current version mới cùng previous key.
3. Chạy dry-run và lưu output chỉ gồm version/count/event.
4. Chạy execute với target confirmation.
5. Xác nhận remaining old-version count bằng `0` và restart không cần old key sau smoke test.
6. Mô phỏng một credential/auth tag lỗi trong database staging snapshot; xác nhận dry-run non-zero và không row nào đổi version.
7. Mô phỏng Meta token code `190`; xác nhận Page bị khóa, operation không retry, rồi verify/sync token mới và xác nhận Page được unlock.

Các unit/integration tests của CLI, transaction rollback và credential incident guard là drill tự động tối thiểu; production vẫn cần operator thực hiện checklist trên đúng staging environment.
