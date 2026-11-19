import Foundation

public enum ChunkStatus: String, Codable, Sendable {
    case pending
    case inProgress
    case done
    case failed
}

/// Một đoạn tài liệu (vài trang) được dịch trong một lần gọi API.
public struct Chunk: Codable, Identifiable, Sendable, Equatable {
    public var id: Int
    /// Trang đầu/cuối trong PDF gốc (đánh số từ 1).
    public var firstPage: Int
    public var lastPage: Int
    public var source: String
    public var status: ChunkStatus
    public var translation: String?
    public var lastError: String?
    public var attempts: Int

    public init(id: Int, firstPage: Int, lastPage: Int, source: String) {
        self.id = id
        self.firstPage = firstPage
        self.lastPage = lastPage
        self.source = source
        self.status = .pending
        self.translation = nil
        self.lastError = nil
        self.attempts = 0
    }

    public var pageLabel: String {
        firstPage == lastPage ? "Trang \(firstPage)" : "Trang \(firstPage)–\(lastPage)"
    }
}

public enum TranslationMode: String, Codable, Sendable, CaseIterable {
    /// Gọi API song song, có kết quả ngay (giá chuẩn).
    case realtime
    /// Message Batches API: rẻ hơn 50%, thường xong trong < 1 giờ (tối đa 24 giờ).
    case batch
}

public enum JobPhase: String, Codable, Sendable {
    case ready
    case running
    case paused
    case batchSubmitted
    case completed
}

public struct UsageTotals: Codable, Sendable, Equatable {
    public var inputTokens: Int = 0
    public var outputTokens: Int = 0
    public var cacheReadTokens: Int = 0
    public var cacheWriteTokens: Int = 0

    public init() {}

    public mutating func add(_ usage: Usage) {
        inputTokens += usage.input_tokens
        outputTokens += usage.output_tokens
        cacheReadTokens += usage.cache_read_input_tokens ?? 0
        cacheWriteTokens += usage.cache_creation_input_tokens ?? 0
    }

    public mutating func add(_ other: UsageTotals) {
        inputTokens += other.inputTokens
        outputTokens += other.outputTokens
        cacheReadTokens += other.cacheReadTokens
        cacheWriteTokens += other.cacheWriteTokens
    }
}

public struct TranslationJob: Codable, Identifiable, Sendable {
    public var id: UUID
    public var title: String
    public var createdAt: Date
    public var pageCount: Int
    public var ocrPageCount: Int
    public var chunks: [Chunk]
    public var phase: JobPhase
    public var mode: TranslationMode
    public var model: String
    public var batchIDs: [String]
    public var batchStatusText: String?
    public var realtimeUsage: UsageTotals
    public var batchUsage: UsageTotals

    public init(title: String, pageCount: Int, ocrPageCount: Int, chunks: [Chunk], model: String) {
        self.id = UUID()
        self.title = title
        self.createdAt = Date()
        self.pageCount = pageCount
        self.ocrPageCount = ocrPageCount
        self.chunks = chunks
        self.phase = .ready
        self.mode = .realtime
        self.model = model
        self.batchIDs = []
        self.batchStatusText = nil
        self.realtimeUsage = UsageTotals()
        self.batchUsage = UsageTotals()
    }

    public var doneCount: Int { chunks.filter { $0.status == .done }.count }
    public var failedCount: Int { chunks.filter { $0.status == .failed }.count }
    public var progress: Double { chunks.isEmpty ? 0 : Double(doneCount) / Double(chunks.count) }
    public var isComplete: Bool { !chunks.isEmpty && doneCount == chunks.count }
    public var sourceCharacterCount: Int { chunks.reduce(0) { $0 + $1.source.count } }
}
