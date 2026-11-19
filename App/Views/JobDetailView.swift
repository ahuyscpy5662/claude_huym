import SwiftUI
import TranslatorCore

struct JobDetailView: View {
    let jobID: UUID
    @EnvironmentObject private var manager: JobManager
    @EnvironmentObject private var settings: SettingsStore

    @State private var mode: TranslationMode = .realtime
    @State private var model: String = ModelCatalog.defaultModel
    @State private var exportURL: URL?
    @State private var exporting = false
    @State private var exportError: String?
    @State private var showOnlyProblems = false

    var body: some View {
        if let job = manager.findJob(jobID) {
            content(job)
        } else {
            ContentUnavailableView("Không tìm thấy tài liệu", systemImage: "doc.questionmark")
        }
    }

    @ViewBuilder
    private func content(_ job: TranslationJob) -> some View {
        let running = manager.isRunning(job.id)
        let batchPending = job.phase == .batchSubmitted
        let refreshing = manager.refreshingBatchIDs.contains(job.id)

        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    ProgressView(value: job.progress)
                        .tint(job.isComplete ? .green : .accentColor)
                    HStack {
                        Text("\(job.doneCount)/\(job.chunks.count) phần")
                        Spacer()
                        Text("\(Int(job.progress * 100))%").monospacedDigit()
                    }
                    .font(.subheadline)
                    if job.failedCount > 0 {
                        Label("\(job.failedCount) phần lỗi — bấm “Dịch tiếp” để thử lại", systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange)
                    }
                    if let status = job.batchStatusText, batchPending || job.mode == .batch {
                        Text(status).font(.caption).foregroundStyle(.secondary)
                    }
                }
                LabeledContent("Bản gốc", value: "\(job.pageCount) trang" + (job.ocrPageCount > 0 ? " (\(job.ocrPageCount) trang OCR)" : ""))
                LabeledContent("Chi phí đã dùng", value: costText(job))
            }

            if !running && !batchPending && !job.isComplete {
                Section {
                    Picker("Cách dịch", selection: $mode) {
                        Text("Nhanh").tag(TranslationMode.realtime)
                        Text("Tiết kiệm 50%").tag(TranslationMode.batch)
                    }
                    .pickerStyle(.segmented)
                    Picker("Mô hình", selection: $model) {
                        ForEach(ModelCatalog.models) { m in
                            Text(m.displayName).tag(m.id)
                        }
                    }
                    LabeledContent("Ước tính phần còn lại", value: estimateText(job))
                } header: {
                    Text("Tuỳ chọn")
                } footer: {
                    Text(mode == .realtime
                         ? "Dịch song song \(settings.concurrency) phần cùng lúc. Giữ app mở (màn hình được giữ sáng) — nếu thoát app, bấm “Dịch tiếp” để dịch phần còn lại."
                         : "Gửi toàn bộ lên Batch API: giá bằng một nửa, có thể đóng app. Thường xong trong vòng 1 giờ (tối đa 24 giờ); mở lại app hoặc kéo để làm mới để nhận kết quả.")
                }
            }

            Section {
                if running {
                    Button(role: .destructive) { manager.pause(job.id) } label: {
                        Label("Tạm dừng", systemImage: "pause.fill")
                    }
                } else if batchPending {
                    Button {
                        Task { await manager.refreshBatch(job.id) }
                    } label: {
                        HStack {
                            Label("Kiểm tra batch", systemImage: "arrow.clockwise")
                            if refreshing { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(refreshing)
                    Button(role: .destructive) {
                        Task { await manager.cancelBatch(job.id) }
                    } label: {
                        Label("Huỷ batch", systemImage: "xmark.circle")
                    }
                    .disabled(refreshing)
                } else if !job.isComplete {
                    Button {
                        if mode == .realtime {
                            manager.startRealtime(job.id, model: model)
                        } else {
                            Task { await manager.submitBatch(job.id, model: model) }
                        }
                    } label: {
                        HStack {
                            Label(job.doneCount == 0 ? "Bắt đầu dịch" : "Dịch tiếp",
                                  systemImage: mode == .realtime ? "play.fill" : "tray.and.arrow.up.fill")
                            if refreshing { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(refreshing || !settings.hasAPIKey)
                }

                Button {
                    Task { await export(job) }
                } label: {
                    HStack {
                        Label(job.isComplete ? "Xuất PDF tiếng Việt" : "Xuất PDF (phần đã dịch)",
                              systemImage: "doc.richtext")
                        if exporting { Spacer(); ProgressView() }
                    }
                }
                .disabled(job.doneCount == 0 || exporting)

                if let exportURL {
                    ShareLink(item: exportURL) {
                        Label("Chia sẻ / Lưu vào Tệp: \(exportURL.lastPathComponent)", systemImage: "square.and.arrow.up")
                    }
                }
                if let exportError {
                    Text(exportError).font(.caption).foregroundStyle(.red)
                }
            }

            Section {
                Toggle("Chỉ hiện phần lỗi / chưa dịch", isOn: $showOnlyProblems)
                ForEach(job.chunks.filter { !showOnlyProblems || $0.status != .done }) { chunk in
                    NavigationLink {
                        ChunkDetailView(jobID: job.id, chunkID: chunk.id)
                    } label: {
                        ChunkRow(chunk: chunk)
                    }
                }
            } header: {
                Text("Các phần (\(job.chunks.count))")
            }
        }
        .navigationTitle(job.title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            model = job.model
            mode = job.mode
            if batchPending { Task { await manager.refreshBatch(job.id) } }
        }
        .refreshable {
            if batchPending { await manager.refreshBatch(job.id) }
        }
    }

    private func export(_ job: TranslationJob) async {
        exporting = true
        exportError = nil
        defer { exporting = false }
        do {
            exportURL = try await manager.exportPDF(job.id)
        } catch {
            exportError = "Xuất PDF thất bại: \(error.localizedDescription)"
        }
    }

    private func costText(_ job: TranslationJob) -> String {
        let cost = ModelCatalog.cost(job.realtimeUsage, model: job.model, batch: false)
            + ModelCatalog.cost(job.batchUsage, model: job.model, batch: true)
        return String(format: "≈ $%.2f", cost)
    }

    private func estimateText(_ job: TranslationJob) -> String {
        let remaining = job.chunks.filter { $0.status != .done }
        let chars = remaining.reduce(0) { $0 + $1.source.count }
        let systemChars = settings.promptBuilder(model: model).systemPrompt.count
        let cost = ModelCatalog.estimate(sourceChars: chars, chunkCount: remaining.count,
                                         systemPromptChars: systemChars, model: model,
                                         batch: mode == .batch)
        return String(format: "≈ $%.2f", cost)
    }
}

struct ChunkRow: View {
    let chunk: Chunk

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            icon.frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text("Phần \(chunk.id + 1) · \(chunk.pageLabel)").font(.subheadline)
                Text(preview).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                if let error = chunk.lastError, chunk.status == .failed {
                    Text(error).font(.caption2).foregroundStyle(.red).lineLimit(2)
                }
            }
        }
    }

    private var preview: String {
        let text = chunk.translation ?? chunk.source
        return text.replacingOccurrences(of: "<<<PAGE", with: "")
            .replacingOccurrences(of: "\n", with: " ")
            .prefix(160)
            .description
    }

    @ViewBuilder private var icon: some View {
        switch chunk.status {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange)
        case .inProgress: ProgressView().controlSize(.small)
        case .pending: Image(systemName: "circle").foregroundStyle(.secondary)
        }
    }
}
