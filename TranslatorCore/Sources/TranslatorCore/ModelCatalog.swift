import Foundation

public struct ModelInfo: Sendable, Identifiable, Equatable {
    public var id: String
    public var displayName: String
    /// USD / 1 triệu token
    public var inputPrice: Double
    public var outputPrice: Double
    public var cacheReadPrice: Double
    public var supportsServerFallback: Bool
}

public enum ModelCatalog {
    public static let defaultModel = "claude-opus-5-5"

    public static let models: [ModelInfo] = [
        ModelInfo(id: "claude-opus-5-5", displayName: "Claude Opus 5.5 (chất lượng cao nhất)",
                  inputPrice: 4, outputPrice: 20, cacheReadPrice: 0.20, supportsServerFallback: true),
        ModelInfo(id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5 (cân bằng)",
                  inputPrice: 2, outputPrice: 10, cacheReadPrice: 0.10, supportsServerFallback: true),
        ModelInfo(id: "claude-haiku-5-5", displayName: "Claude Haiku 5.5 (rẻ nhất)",
                  inputPrice: 0.10, outputPrice: 0.50, cacheReadPrice: 0.01, supportsServerFallback: false),
    ]

    public static func info(_ id: String) -> ModelInfo {
        models.first { $0.id == id } ?? models[0]
    }

    public static func supportsServerFallback(_ id: String) -> Bool {
        info(id).supportsServerFallback
    }

    /// Chi phí ước tính (USD) từ số token thực tế. Batch được giảm 50%.
    public static func cost(_ usage: UsageTotals, model: String, batch: Bool) -> Double {
        let m = info(model)
        let perM = 1_000_000.0
        var total = Double(usage.inputTokens) * m.inputPrice / perM
        total += Double(usage.cacheWriteTokens) * m.inputPrice * 1.25 / perM
        total += Double(usage.cacheReadTokens) * m.cacheReadPrice / perM
        total += Double(usage.outputTokens) * m.outputPrice / perM
        return batch ? total * 0.5 : total
    }

    /// Ước tính sơ bộ trước khi dịch: ~4 ký tự tiếng Anh/token; đầu ra tiếng Việt (kèm suy nghĩ)
    /// khoảng gấp đôi số token đầu vào. Chỉ mang tính tham khảo.
    public static func estimate(sourceChars: Int, chunkCount: Int, systemPromptChars: Int,
                                model: String, batch: Bool) -> Double {
        let sourceTokens = Double(sourceChars) / 4.0
        let systemTokens = Double(systemPromptChars) / 3.5
        var usage = UsageTotals()
        usage.inputTokens = Int(sourceTokens * 1.15)               // + ngữ cảnh đoạn trước
        usage.cacheWriteTokens = Int(systemTokens)                 // lần ghi cache đầu
        usage.cacheReadTokens = Int(systemTokens) * max(0, chunkCount - 1)
        usage.outputTokens = Int(sourceTokens * 2.0)
        return cost(usage, model: model, batch: batch)
    }
}
