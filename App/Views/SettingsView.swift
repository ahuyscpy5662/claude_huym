import SwiftUI
import TranslatorCore

struct SettingsView: View {
    @EnvironmentObject private var settings: SettingsStore
    @Environment(\.dismiss) private var dismiss
    @State private var showKey = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Group {
                            if showKey {
                                TextField("sk-ant-...", text: $settings.apiKey)
                            } else {
                                SecureField("sk-ant-...", text: $settings.apiKey)
                            }
                        }
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(.body, design: .monospaced))
                        Button { showKey.toggle() } label: {
                            Image(systemName: showKey ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.borderless)
                    }
                } header: {
                    Text("Anthropic API key")
                } footer: {
                    Text("Tạo key tại platform.claude.com → API Keys. Key được lưu trong Keychain của máy và chỉ gửi tới api.anthropic.com.")
                }

                Section {
                    Picker("Mô hình mặc định", selection: $settings.model) {
                        ForEach(ModelCatalog.models) { m in
                            Text(m.displayName).tag(m.id)
                        }
                    }
                    Picker("Mức suy nghĩ", selection: $settings.effort) {
                        Text("Thấp (nhanh, rẻ)").tag("low")
                        Text("Vừa (khuyên dùng)").tag("medium")
                        Text("Cao (kỹ nhất)").tag("high")
                    }
                    Stepper("Dịch song song: \(settings.concurrency) phần", value: $settings.concurrency, in: 1...8)
                    Toggle("Ghi kèm thuật ngữ tiếng Anh lần đầu", isOn: $settings.keepEnglishTerms)
                } header: {
                    Text("Dịch")
                } footer: {
                    Text("Opus 5.5 cho chất lượng thuật ngữ tốt nhất. Giảm số phần song song nếu hay gặp lỗi 429 (vượt giới hạn tốc độ của tài khoản).")
                }

                Section {
                    Toggle("Nhận dạng chữ (OCR) cho trang scan", isOn: $settings.ocrEnabled)
                    Stepper("Cỡ mỗi phần: \(settings.chunkChars / 1000)k ký tự",
                            value: $settings.chunkChars, in: 4_000...16_000, step: 1_000)
                } header: {
                    Text("Đọc PDF")
                } footer: {
                    Text("Áp dụng cho tài liệu nhập mới. Phần lớn hơn = ít lần gọi API, văn bản mạch lạc hơn; phần nhỏ hơn = ít rủi ro bị cắt ngang.")
                }

                Section {
                    NavigationLink("Bảng thuật ngữ (\(Glossary.parse(settings.glossaryText).entries.count) mục)") {
                        GlossaryEditorView()
                    }
                } footer: {
                    Text("Thuật ngữ Anh → Việt luôn được ưu tiên khi dịch. Thêm thuật ngữ riêng của bạn để bản dịch nhất quán trong toàn bộ tài liệu.")
                }
            }
            .navigationTitle("Cài đặt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Xong") { dismiss() }
                }
            }
        }
    }
}

struct GlossaryEditorView: View {
    @EnvironmentObject private var settings: SettingsStore
    @State private var confirmReset = false

    var body: some View {
        TextEditor(text: $settings.glossaryText)
            .font(.system(.footnote, design: .monospaced))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 8)
            .navigationTitle("Bảng thuật ngữ")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .top) {
                Text("Mỗi dòng: thuật ngữ tiếng Anh = tiếng Việt (hoặc ngăn cách bằng Tab). Dòng bắt đầu bằng # là ghi chú.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.bar)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Khôi phục mặc định") { confirmReset = true }
                }
            }
            .confirmationDialog("Khôi phục bảng thuật ngữ mặc định? Thuật ngữ bạn đã thêm sẽ mất.",
                                isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Khôi phục", role: .destructive) { settings.resetGlossary() }
            }
    }
}
