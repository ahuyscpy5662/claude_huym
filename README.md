# Dịch PDF Răng Hàm Mặt (EN → VI)

Ứng dụng web tĩnh (chạy hoàn toàn trong trình duyệt) để dịch các tài liệu PDF **tiếng Anh rất dài** chuyên ngành Răng Hàm Mặt (nha khoa, phẫu thuật hàm mặt) sang **tiếng Việt** và xuất ra PDF tiếng Việt. Dùng cho cá nhân.

## Tính năng

- Chọn tệp PDF (hoạt động trên iPhone Safari). Tệp gốc được lưu trong IndexedDB của trình duyệt; sách hàng trăm đến hàng nghìn trang được xử lý từng đoạn, không nạp toàn bộ vào bộ nhớ một lần.
- Cắt PDF thành các đoạn N trang (mặc định 4, cấu hình 1–10) bằng `pdf-lib`; mỗi đoạn gửi cho Claude dưới dạng tệp PDF, nên Claude tự đọc được bảng, bố cục hai cột, trang scan và chú thích hình.
- Dịch trung thực, không tóm tắt, theo thuật ngữ Răng Hàm Mặt chuẩn của sách giáo khoa đại học Y Việt Nam / Bộ Y tế. Bảng thuật ngữ (~190 mục) có thể sửa trong Cài đặt. Tùy chọn ghi kèm thuật ngữ tiếng Anh trong ngoặc ở lần xuất hiện đầu.
- Hai chế độ: **Nhanh** (thời gian thực, nhiều luồng song song) và **Tiết kiệm 50%** (Message Batches API).
- Lưu kết quả từng đoạn ngay khi xong; tạm dừng/tiếp tục; tự thử lại khi lỗi mạng/429/5xx; tự chia nhỏ đoạn nếu bản dịch chạm giới hạn đầu ra; dừng cả job khi khóa API sai hoặc hết credit.
- Xem trang gốc cạnh bản dịch, sửa tay, dịch lại từng đoạn; hiển thị chi phí ước tính trước khi chạy và chi phí thực tế (theo token).
- Xuất PDF A4 với phông Noto Serif (đủ dấu tiếng Việt): trang bìa, tiêu đề, đoạn văn, danh sách, bảng thật, dấu "— trang gốc n —", hình ảnh gốc của từng trang chèn ngay sau nội dung trang đó, số trang ở chân trang. Có thể xuất cả khi mới dịch một phần.
- Giao diện tiếng Việt, responsive, sáng/tối theo hệ thống.

## Cài đặt và chạy

Yêu cầu Node.js 20+.

```bash
npm install
npm run dev        # chạy thử tại http://localhost:5173
npm run build      # tạo thư mục dist/ (tĩnh, base './')
npm run preview    # xem bản build tại http://localhost:4173
npm test           # kiểm thử đơn vị (Vitest)
npm run test:e2e   # build + kiểm thử Playwright (mock API Anthropic)
```

> Không mở trực tiếp `dist/index.html` bằng `file://` (trình duyệt chặn module/worker). Hãy dùng `npm run preview` hoặc một máy chủ tĩnh bất kỳ.

### Triển khai

- **GitHub Pages**: workflow `.github/workflows/deploy.yml` tự build và đăng `dist/` khi push lên nhánh `main`. Trong repo: Settings → Pages → Source = "GitHub Actions". Lưu ý: repo **private** cần gói GitHub trả phí mới dùng được Pages.
- **Thay thế**: kéo thả thư mục `dist/` vào Cloudflare Pages hoặc Netlify (Drop), hoặc chỉ chạy cục bộ bằng `npm run dev` / `npm run preview`.

## Dùng trên iPhone

1. Mở địa chỉ trang đã triển khai (HTTPS) bằng Safari. Có thể "Chia sẻ → Thêm vào MH chính".
2. Cài đặt → dán khóa API Anthropic → Lưu.
3. Trang chủ → "Chọn tệp" → chọn PDF từ Tệp/iCloud Drive.
4. Chọn chế độ rồi bấm dịch. Ở chế độ Nhanh, giữ màn hình sáng và tab mở (ứng dụng dùng Screen Wake Lock khi trình duyệt hỗ trợ). Chế độ Batch thì đóng tab thoải mái.
5. Khi xong (hoặc dở dang) bấm "Xuất PDF" và lưu tệp tải về.

## Hai chế độ

| | Nhanh | Tiết kiệm 50% |
|---|---|---|
| API | Messages (streaming) | Message Batches |
| Chi phí | giá chuẩn | giảm 50% |
| Thời gian | vài giây/đoạn, song song 1–8 luồng | thường dưới 1 giờ, tối đa 24 giờ |
| Cần mở tab | có | không: mở lại, ứng dụng tự hỏi trạng thái; hoặc bấm "Kiểm tra batch" |
| Đoạn lỗi | tự thử lại | đánh dấu lỗi; bấm "Dịch lại đoạn lỗi (Nhanh)" |

Batch được chia thành nhiều lô (~90 MB mỗi lô) để luôn nằm trong giới hạn 256 MB / 100.000 yêu cầu. Có nút hủy batch.

Với Sonnet 5.5 và Opus 5.5, chế độ Nhanh bật sẵn cơ chế dự phòng khi mô hình từ chối (server-side fallback). Haiku 5.5 không có cơ chế này; Batch không hỗ trợ.

## Chi phí ước tính cho sách ~300 trang

Rất sơ bộ (giả định ~2.500 token vào + ~1.500 token ra mỗi trang, mức suy luận trung bình; thực tế phụ thuộc mật độ chữ, hình ảnh và độ dài bản dịch). Giá/triệu token: Sonnet 5,5 $2 vào / $10 ra; Opus 5,5 $4 / $20; Haiku 5,5 $0,10 / $0,50. Prompt hệ thống + bảng thuật ngữ được cache nên các đoạn sau chỉ trả giá đọc cache.

| Mô hình | Nhanh | Tiết kiệm 50% |
|---|---|---|
| Claude Sonnet 5.5 (mặc định) | ≈ $6 | ≈ $3 |
| Claude Opus 5.5 | ≈ $12 | ≈ $6 |
| Claude Haiku 5.5 | ≈ $0,3 | ≈ $0,15 |

Ứng dụng hiển thị ước tính trước khi chạy và chi phí thực tế tính từ `usage` mà API trả về.

## Quyền riêng tư

- Khóa API lưu trong `localStorage` của trình duyệt này và **chỉ được gửi tới `api.anthropic.com`** (qua SDK chính thức, bật `dangerouslyAllowBrowser`). Không có máy chủ trung gian, không có phân tích/theo dõi.
- Vì khóa nằm trong trình duyệt, chỉ dùng trên thiết bị của bạn, không chia sẻ trang đã đăng nhập; nên đặt giới hạn chi tiêu cho khóa trong Anthropic Console.
- Nội dung PDF được gửi tới Anthropic để dịch; PDF gốc và bản dịch lưu trong IndexedDB trên máy bạn. Xóa tài liệu trong ứng dụng sẽ xóa dữ liệu đó.

## Giới hạn

- Bản xuất là **văn bản được dàn lại + hình ảnh gốc**, không giữ nguyên bố cục trang gốc. Hình vẽ vector và chữ nằm trong ảnh không được chèn; ảnh nhỏ (<120 px) và ảnh phủ >80% trang (trang scan) bị bỏ qua.
- Đây là bản dịch máy, cần chuyên gia rà soát trước khi dùng cho học tập hoặc lâm sàng.
- Tệp rất lớn trên iPhone có thể hết bộ nhớ (cắt/xuất PDF chạy trong RAM của trình duyệt). Nên chia sách thành nhiều tệp nhỏ hơn nếu gặp sự cố.
- Dữ liệu nằm trong trình duyệt: xóa dữ liệu trang web hoặc dùng chế độ riêng tư sẽ mất job. Safari có thể dọn dữ liệu của trang lâu không dùng.
- Mỗi yêu cầu tới API tối đa ~32 MB; đoạn có trang scan quá nặng sẽ tự được chia nhỏ.

## Cấu trúc

```
src/lib/      logic: chia đoạn, prompt, Claude (stream/batch), runner, IndexedDB, trích ảnh, xuất PDF (worker)
src/ui/       giao diện (danh sách, chi tiết job, đoạn, cài đặt)
src/assets/fonts/  Noto Serif (SIL OFL)
tests/unit/   Vitest
tests/e2e/    Playwright (mock API Anthropic)
```
