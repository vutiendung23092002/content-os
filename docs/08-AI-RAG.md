# AI CONTENT ASSISTANT

## 1. Mục tiêu MVP

AI chỉ hỗ trợ người vận hành soạn nội dung; AI không tự đăng bài và không tự thay đổi lịch.

Các thao tác đầu tiên:

- tạo một hoặc vài phương án caption từ brief;
- viết lại caption theo giọng điệu hoặc độ dài;
- gợi ý ý tưởng/chủ đề;
- tạo CTA và hashtag;
- kiểm tra nhanh lỗi chính tả, độ rõ ràng và rủi ro diễn đạt.

Mọi kết quả AI phải được người vận hành chọn hoặc sửa trước khi lưu vào draft.

## 2. Phạm vi dữ liệu đầu vào

Prompt có thể chứa:

- brief do người vận hành nhập;
- tên Page và mô tả ngắn do người vận hành cấu hình;
- giọng điệu, đối tượng, mục tiêu và giới hạn độ dài;
- caption draft hiện tại;
- một số bài gần đây của chính Page nếu người vận hành chủ động bật tính năng này.

Không đưa vào prompt:

- Facebook user access token hoặc Page access token;
- header, cookie, secret, log nội bộ;
- dữ liệu không cần thiết cho việc viết nội dung.

## 3. Không dùng RAG trong MVP

MVP chưa cần vector database, embedding pipeline hay pgvector. Lượng ngữ cảnh nhỏ có thể được chọn trực tiếp từ dữ liệu Page đã đồng bộ.

Nếu sau này cần kho kiến thức lớn, RAG chỉ được thêm khi có nhu cầu rõ ràng như nhiều tài liệu thương hiệu, catalog lớn hoặc yêu cầu trích nguồn. Trước khi thêm phải xác định quyền sử dụng và thời hạn lưu dữ liệu.

## 4. Luồng tạo caption

1. Người vận hành chọn Page và nhập brief.
2. Backend lấy cấu hình nội dung tối thiểu của Page.
3. Backend tạo prompt có cấu trúc và gọi AI provider.
4. Kết quả được validate về định dạng, độ dài và số lượng phương án.
5. UI hiển thị kết quả nhưng không tự ghi đè draft.
6. Người vận hành chọn `Use this version` hoặc copy một phần.
7. Lưu prompt metadata, model, chi phí ước tính và kết quả đã chọn; không lưu secret.

## 5. Kiến trúc provider

Ứng dụng dùng một interface nội bộ để tránh phụ thuộc trực tiếp vào một nhà cung cấp:

```ts
interface ContentAIProvider {
  generateCaptions(input: CaptionInput): Promise<CaptionOption[]>;
  rewriteCaption(input: RewriteInput): Promise<CaptionOption[]>;
  suggestIdeas(input: IdeaInput): Promise<ContentIdea[]>;
}
```

Provider phải có timeout, retry hữu hạn cho lỗi tạm thời, rate limit và ghi nhận usage. Không tự động chuyển provider nếu việc đó có thể làm dữ liệu đi sang một bên thứ ba chưa được chấp thuận.

## 6. Guardrail nội dung

- Nói rõ kết quả AI chỉ là bản nháp.
- Không hứa hẹn tính đúng tuyệt đối của thông tin do AI tạo.
- Có cảnh báo khi caption chứa claim y tế, tài chính, pháp lý hoặc ưu đãi khó kiểm chứng.
- Không yêu cầu AI giả mạo cá nhân, tương tác hay số liệu.
- Không tự động sao chép nguyên văn bài cũ.
- Người vận hành chịu trách nhiệm kiểm tra quyền sử dụng văn bản và hình ảnh trước khi đăng.

MVP có thể dùng kiểm tra trùng lặp đơn giản với các caption gần đây. Semantic similarity chỉ thêm sau khi số lượng nội dung đủ lớn để chứng minh nhu cầu.

## 7. Lưu trữ và riêng tư

Bảng `ai_generations` lưu tối thiểu:

- loại tác vụ;
- Page hoặc post liên quan;
- model/provider;
- input đã loại secret;
- output;
- trạng thái và usage;
- thời điểm tạo.

Cho phép xóa lịch sử AI độc lập với draft. Log hệ thống chỉ ghi ID, latency, token usage và lỗi đã làm sạch.

## 8. Tiêu chí hoàn thành MVP

- Tạo và viết lại caption từ UI.
- Kết quả không tự động đăng hoặc lên lịch.
- Không có Facebook token trong request gửi AI, database AI history hoặc log.
- Có timeout, giới hạn số phương án và thông báo lỗi dễ hiểu.
- Có test xác nhận việc chọn kết quả AI mới làm thay đổi draft.
