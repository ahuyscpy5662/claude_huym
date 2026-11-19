import SwiftUI
import UniformTypeIdentifiers
import TranslatorCore

struct JobListView: View {
    @EnvironmentObject private var manager: JobManager
    @EnvironmentObject private var settings: SettingsStore
    @State private var showImporter = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            List {
                if !settings.hasAPIKey {
                    Section {
                        Button {
                            showSettings = true
                        } label: {
                            Label("Nhập Anthropic API key để bắt đầu", systemImage: "key.fill")
                        }
                    }
                }

                if let state = manager.importState {
                    Section("Đang đọc PDF") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(state.fileName).font(.subheadline).lineLimit(1)
                            if state.total > 0 {
                                ProgressView(value: Double(state.done), total: Double(state.total))
                                Text("Trang \(state.done)/\(state.total)")
                                    .font(.caption).foregroundStyle(.secondary)
                            } else {
                                ProgressView()
                            }
                            Button("Huỷ", role: .cancel) { manager.cancelImport() }
                                .font(.caption)
                        }
                    }
                }

                Section {
                    ForEach(manager.jobs) { job in
                        NavigationLink(value: job.id) {
                            JobRow(job: job, running: manager.isRunning(job.id))
                        }
                    }
                    .onDelete { offsets in
                        let ids = offsets.map { manager.jobs[$0].id }
                        for id in ids { manager.delete(id) }
                    }
                } header: {
                    if !manager.jobs.isEmpty { Text("Tài liệu") }
                } footer: {
                    if manager.jobs.isEmpty && manager.importState == nil {
                        Text("Bấm + để chọn file PDF tiếng Anh (sách, bài báo, hướng dẫn lâm sàng Răng Hàm Mặt). Tài liệu dài hàng trăm trang được chia thành nhiều phần và dịch dần; có thể tạm dừng và tiếp tục bất cứ lúc nào.")
                    }
                }
            }
            .navigationTitle("Dịch tài liệu RHM")
            .navigationDestination(for: UUID.self) { id in
                JobDetailView(jobID: id)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showImporter = true } label: { Image(systemName: "plus") }
                        .disabled(manager.importState != nil)
                }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf]) { result in
                if case let .success(url) = result {
                    manager.importPDF(from: url)
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .refreshable { await manager.refreshAllBatches() }
            .alert("Lỗi", isPresented: Binding(
                get: { manager.errorMessage != nil },
                set: { if !$0 { manager.errorMessage = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(manager.errorMessage ?? "")
            }
        }
    }
}

struct JobRow: View {
    let job: TranslationJob
    let running: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(job.title).font(.headline).lineLimit(2)
            HStack(spacing: 8) {
                Text("\(job.pageCount) trang")
                Text("·")
                Text(statusText)
                    .foregroundStyle(job.failedCount > 0 ? .orange : .secondary)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            ProgressView(value: job.progress)
                .tint(job.isComplete ? .green : .accentColor)
        }
        .padding(.vertical, 4)
    }

    private var statusText: String {
        if running { return "Đang dịch \(Int(job.progress * 100))%" }
        switch job.phase {
        case .batchSubmitted: return "Đang chờ Batch"
        case .completed: return "Hoàn tất"
        default:
            if job.failedCount > 0 { return "\(job.doneCount)/\(job.chunks.count) phần · \(job.failedCount) lỗi" }
            return job.doneCount == 0 ? "Chưa dịch" : "\(job.doneCount)/\(job.chunks.count) phần"
        }
    }
}
