# ARCHITECTURE DECISION RECORDS

## ADR-001 — Công cụ nội bộ một người vận hành

- **Status:** Accepted
- **Context:** Chủ hệ thống dùng chính token Facebook của mình để quản lý các Page có quyền.
- **Decision:** MVP là single-operator, không có tài khoản khách hàng, team, role hay approval workflow.
- **Alternatives:** OAuth đa tenant; hệ thống nhiều người dùng ngay từ đầu.
- **Consequences:** Phạm vi nhỏ và nhanh kiểm chứng; production vẫn cần access gateway hoặc admin protection.
- **Revisit when:** Có người thứ hai cần quyền độc lập hoặc khách hàng cần tự kết nối Page.

## ADR-002 — Token được cấu hình server-side

- **Status:** Accepted
- **Context:** Người vận hành đã có user access token dùng được để lấy các Page token.
- **Decision:** User token nằm trong secret manager/env của server; client không nhập hoặc nhận token.
- **Alternatives:** Facebook Login/OAuth trong UI; lưu token trong browser.
- **Consequences:** Không có onboarding OAuth nhưng rotation là thao tác vận hành thủ công.
- **Revisit when:** Có người dùng khác cần kết nối tài khoản Facebook của họ.

## ADR-003 — Dùng native scheduling của Facebook

- **Status:** Accepted
- **Context:** Bài phải được Facebook giữ lịch và đăng ngay cả khi ứng dụng offline.
- **Decision:** Khi schedule, gọi Graph API với `published=false` và `scheduled_publish_time`; lưu remote ID.
- **Alternatives:** Worker của ứng dụng chờ đến hạn rồi gọi publish.
- **Consequences:** Giảm rủi ro downtime tại giờ đăng; phải đồng bộ trạng thái remote và tuân theo giới hạn Meta.
- **Revisit when:** Một kênh khác không có native scheduling hoặc use case không được Meta hỗ trợ.

## ADR-004 — Meta là nguồn sự thật cho remote post

- **Status:** Accepted
- **Context:** Bài/lịch có thể bị sửa trực tiếp trong Meta Business Suite.
- **Decision:** Scheduled/published state được xác nhận từ Graph API; database chỉ là mirror và nơi giữ draft/mapping.
- **Alternatives:** Tin hoàn toàn vào trạng thái local.
- **Consequences:** Cần sync/reconciliation và UI hiển thị độ mới dữ liệu.
- **Revisit when:** Không có remote API đáng tin cậy cho một loại nội dung cụ thể.

## ADR-005 — PostgreSQL cho draft và operation ledger

- **Status:** Accepted
- **Context:** Hệ thống cần giao dịch, mapping remote ID và truy vết mutation.
- **Decision:** Dùng PostgreSQL + Drizzle cho draft, Page, token mã hóa, operation và AI history.
- **Alternatives:** Chỉ dùng file/SQLite; document database.
- **Consequences:** Có migration và backup rõ ràng; cần vận hành database.
- **Revisit when:** Deployment chỉ local và không còn nhu cầu concurrency/backup server.

## ADR-006 — Không có publish worker trong MVP

- **Status:** Accepted
- **Context:** Facebook native scheduling chịu trách nhiệm đăng đúng giờ.
- **Decision:** Cron chỉ sync và reconcile; không dùng Trigger.dev/queue để bắn publish lúc đến hạn.
- **Alternatives:** Trigger.dev, BullMQ hoặc scheduler tự xây.
- **Consequences:** Ít thành phần hơn; vẫn cần cron cho trạng thái và lỗi không chắc chắn.
- **Revisit when:** Tích hợp kênh không hỗ trợ native schedule hoặc khối lượng sync vượt giới hạn cron.

## ADR-007 — Mã hóa Page token ở tầng ứng dụng

- **Status:** Accepted
- **Context:** Page token phải được dùng lại nhưng database có thể bị đọc độc lập.
- **Decision:** Page token dùng authenticated encryption; encryption key nằm ngoài database và ciphertext có version.
- **Alternatives:** Plaintext; chỉ dựa vào disk encryption.
- **Consequences:** Giảm tác động khi database lộ; cần rotation và recovery procedure.
- **Revisit when:** Chuyển toàn bộ credential sang vault hỗ trợ token proxy trực tiếp.

## ADR-008 — Chỉ dùng API chính thức của Meta

- **Status:** Accepted
- **Context:** Mục tiêu quan trọng nhất là giảm rủi ro vi phạm Facebook.
- **Decision:** Cấm scraping, browser automation, cookie automation và private endpoint.
- **Alternatives:** Tự động hóa UI khi API thiếu chức năng.
- **Consequences:** Một số tính năng phải hoãn hoặc bỏ nếu Graph API không hỗ trợ.
- **Revisit when:** Không xem xét lại trừ khi Meta cung cấp API chính thức mới.

## ADR-009 — AI luôn có người duyệt

- **Status:** Accepted
- **Context:** AI có thể tạo claim sai, nội dung không phù hợp hoặc trùng lặp.
- **Decision:** AI chỉ đề xuất; người vận hành phải chọn/sửa và tự bấm publish/schedule.
- **Alternatives:** AI tự tạo và tự đăng.
- **Consequences:** An toàn hơn nhưng không phải hệ thống hoàn toàn tự động.
- **Revisit when:** Chỉ xem xét automation hạn chế sau khi có guardrail, audit và use case rõ ràng.

## ADR-010 — Text trước, single image sau

- **Status:** Accepted
- **Context:** Media làm tăng số endpoint, upload lifecycle và lỗi khó đối soát.
- **Decision:** Hoàn thiện text post trước; sau đó mới thêm một ảnh mỗi bài. Video/carousel/Reels ngoài MVP.
- **Alternatives:** Hỗ trợ mọi định dạng ngay từ đầu.
- **Consequences:** MVP nhỏ hơn, capability test rõ hơn.
- **Revisit when:** Text flow đạt tiêu chí ổn định và single image là nhu cầu vận hành thực tế.

## ADR-011 — Access gateway thay cho hệ thống auth đầy đủ

- **Status:** Accepted
- **Context:** Chỉ một operator nhưng endpoint publish không được public.
- **Decision:** Production dùng access gateway/VPN hoặc admin session nhỏ; không xây user/role database.
- **Alternatives:** Không bảo vệ; auth đa người dùng đầy đủ.
- **Consequences:** Vận hành đơn giản, phụ thuộc một lớp bảo vệ hạ tầng.
- **Revisit when:** Cần audit danh tính nhiều người hoặc phân quyền.

## ADR-012 — Pin Graph version và smoke test capability

- **Status:** Accepted
- **Context:** Permission, field, endpoint và giới hạn của Meta thay đổi theo version/thời gian.
- **Decision:** Graph version là cấu hình bắt buộc; release chỉ qua khi test Page xác nhận publish/schedule/list/reschedule/cancel.
- **Alternatives:** Dùng version mặc định và dựa vào ghi nhớ tài liệu.
- **Consequences:** Có bước kiểm chứng trước release và quy trình nâng version chủ động.
- **Revisit when:** Không bỏ; chỉ điều chỉnh bộ capability theo phạm vi sản phẩm.
