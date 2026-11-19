import Foundation
import SwiftUI
import UIKit
import TranslatorCore

struct ImportState: Equatable {
    var fileName: String
    var done: Int = 0
    var total: Int = 0
}

/// Điều phối: nhập PDF → chia đoạn → dịch (song song hoặc Batch) → lưu tiến độ → xuất PDF.
@MainActor
final class JobManager: ObservableObject {
    @Published private(set) var jobs: [TranslationJob] = []
    @Published var importState: ImportState?
    @Published var errorMessage: String?
    @Published private(set) var runningJobIDs: Set<UUID> = []
    @Published private(set) var refreshingBatchIDs: Set<UUID> = []

    let settings: SettingsStore
    private let store = JobStore()
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private var importTask: Task<Void, Never>?
    private var dirty: Set<UUID> = []
    private var saveScheduled = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    /// Số yêu cầu tối đa trong một batch (giới hạn API: 100.000 yêu cầu / 256 MB).
    private let maxRequestsPerBatch = 2_000

    init(settings: SettingsStore) {
        self.settings = settings
        var loaded = store.loadAllSync()
        // App bị tắt giữa chừng: các đoạn đang dịch dở quay về "chờ".
        for i in loaded.indices {
            for j in loaded[i].chunks.indices where loaded[i].chunks[j].status == .inProgress && loaded[i].phase != .batchSubmitted {
                loaded[i].chunks[j].status = .pending
            }
            if loaded[i].phase == .running { loaded[i].phase = .paused }
        }
        jobs = loaded
    }

    func findJob(_ id: UUID) -> TranslationJob? { jobs.first { $0.id == id } }
    func isRunning(_ id: UUID) -> Bool { runningJobIDs.contains(id) }

    // MARK: - Import

    func importPDF(from url: URL) {
        importTask?.cancel()
        importTask = Task { await performImport(url) }
    }

    func cancelImport() {
        importTask?.cancel()
        importState = nil
    }

    private func performImport(_ url: URL) async {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }

        let fileName = url.lastPathComponent
        importState = ImportState(fileName: fileName)

        // Sao chép vào thư mục tạm để PDFKit đọc ổn định khi file nằm trong iCloud/Files.
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        do {
            try FileManager.default.copyItem(at: url, to: temp)
        } catch {
            importState = nil
            errorMessage = "Không đọc được file: \(error.localizedDescription)"
            return
        }
        defer { try? FileManager.default.removeItem(at: temp) }

        do {
            let result = try await PDFTextExtractor.extract(url: temp, useOCR: settings.ocrEnabled) { done, total in
                Task { @MainActor [weak self] in
                    self?.importState?.done = done
                    self?.importState?.total = total
                }
            }
            let chunkChars = settings.chunkChars
            let chunks = await Task.detached(priority: .userInitiated) {
                Chunker(targetChars: chunkChars).makeChunks(pages: TextCleaner.clean(pages: result.pages))
            }.value
            guard !chunks.isEmpty else { throw PDFExtractionError.noText }

            let job = TranslationJob(title: result.title, pageCount: result.pages.count,
                                     ocrPageCount: result.ocrPageCount, chunks: chunks, model: settings.model)
            jobs.insert(job, at: 0)
            await store.save(job)
        } catch is CancellationError {
            // người dùng huỷ
        } catch {
            errorMessage = error.localizedDescription
        }
        importState = nil
    }

    // MARK: - Realtime translation

    /// Dịch song song các đoạn chưa xong (kể cả đoạn lỗi). Tiến độ được lưu liên tục.
    func startRealtime(_ id: UUID, model: String? = nil) {
        guard tasks[id] == nil, var job = findJob(id) else { return }
        guard settings.hasAPIKey else {
            errorMessage = "Hãy nhập Anthropic API key trong Cài đặt."
            return
        }
        guard job.phase != .batchSubmitted else {
            errorMessage = "Tác vụ đang chờ kết quả Batch. Hãy kiểm tra hoặc huỷ batch trước."
            return
        }

        if let model { job.model = model }
        let work = job.chunks.filter { $0.status != .done }.map { chunk in
            WorkItem(chunkID: chunk.id, source: chunk.source,
                     context: chunk.id > 0 ? Chunker.tail(of: job.chunks[chunk.id - 1].source) : nil)
        }
        guard !work.isEmpty else { return }

        for i in job.chunks.indices where job.chunks[i].status == .failed {
            job.chunks[i].status = .pending
        }
        job.phase = .running
        job.mode = .realtime
        replace(job)

        let translator = ChunkTranslator(client: AnthropicClient(apiKey: settings.apiKey),
                                         prompt: settings.promptBuilder(model: job.model),
                                         documentTitle: job.title)
        let limit = max(1, settings.concurrency)

        runningJobIDs.insert(id)
        updateIdleTimer()

        tasks[id] = Task { [weak self] in
            await withTaskGroup(of: (Int, Result<TranslationOutput, Error>).self) { group in
                var next = 0
                func enqueue() {
                    let item = work[next]
                    next += 1
                    self?.mutate(id) { $0.chunks[item.chunkID].status = .inProgress }
                    group.addTask {
                        do {
                            return (item.chunkID, .success(try await translator.translate(source: item.source,
                                                                                         previousContext: item.context)))
                        } catch {
                            return (item.chunkID, .failure(error))
                        }
                    }
                }
                while next < min(limit, work.count) { enqueue() }

                for await (chunkID, result) in group {
                    guard let self else { break }
                    let fatal = self.apply(id, chunkID: chunkID, result: result)
                    if fatal {
                        group.cancelAll()
                        break
                    }
                    if next < work.count && !Task.isCancelled { enqueue() }
                }
            }
            self?.finishRun(id)
        }
    }

    func pause(_ id: UUID) {
        tasks[id]?.cancel()
    }

    private struct WorkItem: Sendable {
        var chunkID: Int
        var source: String
        var context: String?
    }

    /// Ghi kết quả một đoạn. Trả về true nếu là lỗi nghiêm trọng cần dừng cả tác vụ.
    private func apply(_ id: UUID, chunkID: Int, result: Result<TranslationOutput, Error>) -> Bool {
        var fatal = false
        mutate(id) { job in
            job.chunks[chunkID].attempts += 1
            switch result {
            case let .success(output):
                job.chunks[chunkID].status = .done
                job.chunks[chunkID].translation = output.text
                job.chunks[chunkID].lastError = nil
                job.realtimeUsage.add(output.usage)
            case let .failure(error):
                if error is CancellationError {
                    job.chunks[chunkID].status = .pending
                    return
                }
                job.chunks[chunkID].status = .failed
                job.chunks[chunkID].lastError = error.localizedDescription
                if let apiError = error as? AnthropicError, apiError.isFatal {
                    fatal = true
                    errorMessage = apiError.localizedDescription
                }
            }
        }
        return fatal
    }

    private func finishRun(_ id: UUID) {
        tasks[id] = nil
        runningJobIDs.remove(id)
        mutate(id) { job in
            for i in job.chunks.indices where job.chunks[i].status == .inProgress {
                job.chunks[i].status = .pending
            }
            job.phase = job.isComplete ? .completed : .paused
        }
        flushSaves()
        updateIdleTimer()
        if findJob(id)?.isComplete == true {
            notifyCompletion(id)
        }
    }

    // MARK: - Batch (giảm 50% chi phí)

    func submitBatch(_ id: UUID, model: String? = nil) async {
        guard var job = findJob(id), tasks[id] == nil else { return }
        guard settings.hasAPIKey else {
            errorMessage = "Hãy nhập Anthropic API key trong Cài đặt."
            return
        }
        if let model { job.model = model }
        let prompt = settings.promptBuilder(model: job.model)
        let items = job.chunks.filter { $0.status != .done }.map { chunk in
            BatchRequestItem(
                custom_id: "chunk-\(chunk.id)",
                params: prompt.request(source: chunk.source,
                                       previousContext: chunk.id > 0 ? Chunker.tail(of: job.chunks[chunk.id - 1].source) : nil,
                                       documentTitle: job.title,
                                       allowFallbacks: false))
        }
        guard !items.isEmpty else { return }

        let client = AnthropicClient(apiKey: settings.apiKey)
        refreshingBatchIDs.insert(id)
        defer { refreshingBatchIDs.remove(id) }
        var submitted: [String] = []
        do {
            for start in stride(from: 0, to: items.count, by: maxRequestsPerBatch) {
                let slice = Array(items[start..<min(start + maxRequestsPerBatch, items.count)])
                let info = try await client.createBatch(slice)
                submitted.append(info.id)
            }
        } catch {
            errorMessage = "Gửi batch thất bại: \(error.localizedDescription)"
            if submitted.isEmpty { return }
        }
        let submittedCount = min(items.count, submitted.count * maxRequestsPerBatch)
        let submittedIDs = Set(items.prefix(submittedCount).map(\.custom_id))
        job.batchIDs.append(contentsOf: submitted)
        for i in job.chunks.indices where submittedIDs.contains("chunk-\(job.chunks[i].id)") {
            job.chunks[i].status = .inProgress
            job.chunks[i].lastError = nil
        }
        job.phase = .batchSubmitted
        job.mode = .batch
        job.batchStatusText = "Đã gửi \(submittedCount) đoạn. Thường xong trong vòng 1 giờ (tối đa 24 giờ)."
        replace(job)
        flushSaves()
    }

    /// Kiểm tra trạng thái batch; batch nào xong thì tải kết quả về.
    func refreshBatch(_ id: UUID) async {
        guard let job = findJob(id), !job.batchIDs.isEmpty, !refreshingBatchIDs.contains(id) else { return }
        guard settings.hasAPIKey else { return }
        refreshingBatchIDs.insert(id)
        defer { refreshingBatchIDs.remove(id) }

        let client = AnthropicClient(apiKey: settings.apiKey)
        var statusParts: [String] = []
        for batchID in job.batchIDs {
            do {
                let info = try await client.getBatch(id: batchID)
                if info.processing_status == "ended", let resultsURL = info.results_url {
                    let lines = try await client.batchResults(resultsURL: resultsURL)
                    applyBatchResults(id, batchID: batchID, lines: lines)
                } else {
                    let c = info.request_counts
                    statusParts.append("Đang xử lý: \(c.processing) · xong: \(c.succeeded) · lỗi: \(c.errored + c.expired + c.canceled)")
                }
            } catch {
                statusParts.append("Lỗi kiểm tra batch: \(error.localizedDescription)")
            }
        }
        mutate(id) { job in
            if job.batchIDs.isEmpty {
                for i in job.chunks.indices where job.chunks[i].status == .inProgress {
                    job.chunks[i].status = .failed
                    job.chunks[i].lastError = "Không có trong kết quả batch."
                }
                job.phase = job.isComplete ? .completed : .paused
                job.batchStatusText = job.isComplete
                    ? "Batch hoàn tất."
                    : "Batch xong, còn \(job.failedCount) đoạn lỗi — bấm “Dịch tiếp” để dịch lại trực tiếp."
            } else {
                job.batchStatusText = statusParts.joined(separator: "\n")
            }
        }
        flushSaves()
        if findJob(id)?.isComplete == true { notifyCompletion(id) }
    }

    private func applyBatchResults(_ id: UUID, batchID: String, lines: [BatchResultLine]) {
        mutate(id) { job in
            for line in lines {
                guard line.custom_id.hasPrefix("chunk-"),
                      let chunkID = Int(line.custom_id.dropFirst("chunk-".count)),
                      job.chunks.indices.contains(chunkID) else { continue }
                job.chunks[chunkID].attempts += 1
                if line.result.type == "succeeded", let message = line.result.message {
                    if let usage = message.usage { job.batchUsage.add(usage) }
                    let text = message.text.trimmingCharacters(in: .whitespacesAndNewlines)
                    switch message.stop_reason {
                    case "refusal":
                        job.chunks[chunkID].status = .failed
                        job.chunks[chunkID].lastError = AnthropicError.refusal.localizedDescription
                    case "max_tokens":
                        job.chunks[chunkID].status = .failed
                        job.chunks[chunkID].lastError = "Đoạn quá dài (max_tokens) — dịch trực tiếp sẽ tự chia nhỏ."
                    default:
                        if text.isEmpty {
                            job.chunks[chunkID].status = .failed
                            job.chunks[chunkID].lastError = AnthropicError.emptyResponse.localizedDescription
                        } else {
                            job.chunks[chunkID].status = .done
                            job.chunks[chunkID].translation = text
                            job.chunks[chunkID].lastError = nil
                        }
                    }
                } else {
                    job.chunks[chunkID].status = .failed
                    job.chunks[chunkID].lastError = "Batch: \(line.result.type)"
                        + (line.result.error?.error?.message.map { " — \($0)" } ?? "")
                }
            }
            job.batchIDs.removeAll { $0 == batchID }
        }
    }

    func cancelBatch(_ id: UUID) async {
        guard let job = findJob(id) else { return }
        let client = AnthropicClient(apiKey: settings.apiKey)
        for batchID in job.batchIDs {
            _ = try? await client.cancelBatch(id: batchID)
        }
        // Batch bị huỷ vẫn trả kết quả cho các yêu cầu đã xong → lấy về.
        mutate(id) { $0.batchStatusText = "Đang huỷ… bấm “Kiểm tra batch” sau ít phút để lấy phần đã xong." }
        await refreshBatch(id)
    }

    func refreshAllBatches() async {
        for job in jobs where job.phase == .batchSubmitted {
            await refreshBatch(job.id)
        }
    }

    // MARK: - Chỉnh sửa / xoá / xuất

    func retranslate(_ id: UUID, chunkID: Int) {
        mutate(id) { job in
            job.chunks[chunkID].status = .pending
        }
        startRealtime(id)
    }

    func updateTranslation(_ id: UUID, chunkID: Int, text: String) {
        mutate(id) { job in
            job.chunks[chunkID].translation = text
            job.chunks[chunkID].status = text.isEmpty ? .pending : .done
        }
        flushSaves()
    }

    func delete(_ id: UUID) {
        tasks[id]?.cancel()
        jobs.removeAll { $0.id == id }
        Task { await store.delete(id) }
    }

    func exportPDF(_ id: UUID) async throws -> URL {
        guard let job = findJob(id) else { throw PDFExtractionError.cannotOpen }
        let safeTitle = job.title
            .components(separatedBy: CharacterSet(charactersIn: "/\\:?%*|\"<>"))
            .joined(separator: "-")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(safeTitle) - Tieng Viet.pdf")
        try await Task.detached(priority: .userInitiated) {
            try PDFExporter().export(job: job, to: url)
        }.value
        return url
    }

    // MARK: - Lifecycle

    func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .background:
            flushSaves()
            // Xin iOS thêm thời gian để các đoạn đang dịch kịp xong trước khi app bị tạm dừng.
            if !runningJobIDs.isEmpty && backgroundTask == .invalid {
                backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "translate") { [weak self] in
                    Task { @MainActor in self?.endBackgroundTask() }
                }
            }
        case .active:
            endBackgroundTask()
            Task { await refreshAllBatches() }
        default:
            break
        }
    }

    private func endBackgroundTask() {
        if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
    }

    private func updateIdleTimer() {
        // Giữ màn hình sáng khi đang dịch trực tiếp (iOS dừng mạng khi app chạy nền lâu).
        UIApplication.shared.isIdleTimerDisabled = !runningJobIDs.isEmpty
    }

    private func notifyCompletion(_ id: UUID) {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    // MARK: - State helpers

    private func replace(_ job: TranslationJob) {
        if let index = jobs.firstIndex(where: { $0.id == job.id }) {
            jobs[index] = job
            markDirty(job.id)
        }
    }

    private func mutate(_ id: UUID, _ body: (inout TranslationJob) -> Void) {
        guard let index = jobs.firstIndex(where: { $0.id == id }) else { return }
        body(&jobs[index])
        markDirty(id)
    }

    /// Ghi đĩa tối đa ~2 giây/lần — tài liệu lớn có file trạng thái hàng chục MB.
    private func markDirty(_ id: UUID) {
        dirty.insert(id)
        guard !saveScheduled else { return }
        saveScheduled = true
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            self?.flushSaves()
        }
    }

    private func flushSaves() {
        saveScheduled = false
        let snapshot = jobs.filter { dirty.contains($0.id) }
        dirty.removeAll()
        let store = self.store
        Task.detached(priority: .utility) {
            for job in snapshot { await store.save(job) }
        }
    }
}
