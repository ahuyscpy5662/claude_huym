# Dịch RHM — App iOS dịch tài liệu PDF tiếng Anh chuyên ngành Răng Hàm Mặt

App iOS (SwiftUI) dùng cá nhân: chọn file PDF tiếng Anh (sách, bài báo, hướng dẫn lâm sàng…),
dịch sang tiếng Việt bằng Claude API với bảng thuật ngữ Răng Hàm Mặt, rồi xuất **file PDF tiếng Việt**.
Thiết kế cho tài liệu **rất dài** (hàng trăm – hàng nghìn trang).

## Tính năng

- **Đọc PDF lớn**: trích chữ từng trang bằng PDFKit; trang là ảnh scan thì tự **OCR** bằng Vision (chạy trên máy).
- **Làm sạch**: bỏ header/footer lặp lại, số trang, nối từ bị gạch nối cuối dòng.
- **Chia phần thông minh** (~9.000 ký tự/phần, chỉnh được), giữ dấu trang gốc `<<<PAGE n>>>` → PDF đầu ra có ghi “— trang gốc n —” để đối chiếu.
- **Hai cách dịch**:
  - **Nhanh** — dịch song song (mặc định 4 phần cùng lúc), tự thử lại khi gặp lỗi 429/529/5xx, tự chia nhỏ phần quá dài.
  - **Tiết kiệm 50%** — gửi toàn bộ qua **Message Batches API**, có thể đóng app; thường xong trong vòng 1 giờ (tối đa 24 giờ). Mở lại app/kéo để làm mới là nhận kết quả.
- **Bảng thuật ngữ RHM** (~190 mục: giải phẫu, nội nha, nha chu, phục hình, chỉnh nha, phẫu thuật hàm mặt, chẩn đoán hình ảnh…) — sửa/thêm trong Cài đặt. Thuật ngữ quan trọng được ghi kèm tiếng Anh trong ngoặc ở lần đầu (tắt được).
- **Prompt caching**: system prompt + bảng thuật ngữ được cache → các phần sau chỉ trả ~5% giá phần đầu vào cố định.
- **Lưu tiến độ liên tục**: tắt app giữa chừng vẫn dịch tiếp được; phần lỗi có thể dịch lại riêng; xem song song bản gốc/bản dịch và sửa tay từng phần.
- **Xuất PDF A4** (CoreText, font Times New Roman hỗ trợ đầy đủ dấu tiếng Việt): trang bìa, heading, danh sách, bảng, đánh số trang. Xuất được cả khi mới dịch xong một phần.
- **Chi phí**: hiển thị ước tính trước khi dịch và chi phí thực tế theo số token.
- API key lưu trong **Keychain**, chỉ gửi tới `api.anthropic.com`.

## Cài đặt (cần máy Mac)

1. Cài Xcode 15 trở lên và [XcodeGen](https://github.com/yonaskolb/XcodeGen):
   ```bash
   brew install xcodegen
   ```
2. Sinh project và mở:
   ```bash
   cd claude_huym
   xcodegen generate
   open DentalTranslator.xcodeproj
   ```
3. Trong Xcode → target **DentalTranslator** → *Signing & Capabilities* → chọn Team (Apple ID cá nhân miễn phí cũng được).
   Nếu bundle id bị trùng, đổi `com.personal.dentaltranslator` thành tên khác.
4. Cắm iPhone/iPad, chọn thiết bị → **Run** (⌘R). Lần đầu cần vào *Cài đặt → Cài đặt chung → Quản lý VPN & thiết bị* để tin cậy nhà phát triển.
   > Với Apple ID miễn phí, app hết hạn sau 7 ngày — chỉ cần Run lại từ Xcode. Tài khoản Apple Developer trả phí: 1 năm.
5. Mở app → ⚙︎ → dán **Anthropic API key** (tạo tại platform.claude.com → API Keys).

Không có Mac? Có thể tạo project bằng Xcode Cloud / máy Mac thuê, hoặc chuyển sang dạng web app — báo mình nếu cần.

### Chạy unit test phần lõi

```bash
cd TranslatorCore && swift test
```

## Cách dùng

1. Bấm **+** → chọn file PDF (từ Tệp, iCloud Drive…). App đọc và chia phần (hiện tiến độ từng trang).
2. Mở tài liệu → chọn **Nhanh** hoặc **Tiết kiệm 50%**, chọn mô hình → **Bắt đầu dịch**.
   - Chế độ Nhanh: giữ app mở (màn hình tự giữ sáng). Thoát app thì bấm **Dịch tiếp** để làm phần còn lại.
   - Chế độ Batch: có thể đóng app; quay lại bấm **Kiểm tra batch**.
3. Phần lỗi (nếu có) → bấm **Dịch tiếp** để dịch lại trực tiếp.
4. **Xuất PDF tiếng Việt** → **Chia sẻ / Lưu vào Tệp**.

## Chi phí tham khảo

Ước tính sơ bộ cho sách 300 trang (~900.000 ký tự tiếng Anh), mức suy nghĩ "Vừa":

| Mô hình | Nhanh | Batch (−50%) |
|---|---|---|
| Claude Opus 5.5 (mặc định, chất lượng cao nhất) | ~ $10 | ~ $5 |
| Claude Sonnet 5.5 | ~ $5 | ~ $2,5 |
| Claude Haiku 5.5 | ~ $0,25 | ~ $0,13 |

Số thực tế phụ thuộc mật độ chữ và độ dài bản dịch; app hiển thị ước tính cho chính tài liệu của bạn trước khi dịch.

## Cấu trúc mã

```
project.yml                     # cấu hình XcodeGen
App/
  DentalTranslatorApp.swift
  Services/
    PDFTextExtractor.swift      # PDFKit + OCR (Vision)
    JobManager.swift            # điều phối dịch song song / Batch, lưu tiến độ
    PDFExporter.swift           # Markdown → PDF tiếng Việt (CoreText, phân trang)
    JobStore.swift, SettingsStore.swift, Keychain.swift
  Views/                        # SwiftUI: danh sách, chi tiết, từng phần, cài đặt, thuật ngữ
TranslatorCore/                 # Swift package thuần Foundation (test được bằng `swift test`)
  Sources/TranslatorCore/
    TextCleaner.swift           # bỏ header/footer, nối gạch nối
    Chunker.swift               # chia phần + dấu trang
    Glossary.swift              # bảng thuật ngữ RHM mặc định
    PromptBuilder.swift         # system prompt dịch thuật y khoa
    AnthropicClient.swift       # Messages API + Message Batches API (HTTP)
    ChunkTranslator.swift       # retry/backoff, tự chia nhỏ khi chạm max_tokens
    MarkdownLite.swift          # parse bản dịch để dựng PDF
    ModelCatalog.swift          # giá, ước tính chi phí
```

## Giới hạn hiện tại

- PDF đầu ra **không giữ nguyên bố cục/hình ảnh** của bản gốc — chỉ chứa văn bản đã dịch (có đánh dấu trang gốc để đối chiếu).
- Bảng được hiển thị dạng từng hàng, các ô ngăn cách bằng “│”.
- Chế độ Nhanh cần app mở; iOS dừng kết nối mạng khi app chạy nền lâu.
- Đây là bản dịch máy — nên được hiệu đính trước khi dùng cho mục đích lâm sàng hoặc xuất bản.
