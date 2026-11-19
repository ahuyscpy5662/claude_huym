import Foundation

// MARK: - Request

public struct CacheControl: Codable, Sendable, Equatable {
    public var type: String = "ephemeral"
    public init() {}
}

public struct SystemBlock: Codable, Sendable, Equatable {
    public var type: String = "text"
    public var text: String
    public var cache_control: CacheControl?

    public init(text: String, cache_control: CacheControl? = nil) {
        self.text = text
        self.cache_control = cache_control
    }
}

public struct InputMessage: Codable, Sendable, Equatable {
    public var role: String
    public var content: String
}

public struct OutputConfig: Codable, Sendable, Equatable {
    public var effort: String
}

public struct MessageRequest: Codable, Sendable, Equatable {
    public var model: String
    public var max_tokens: Int
    public var system: [SystemBlock]
    public var messages: [InputMessage]
    public var output_config: OutputConfig
    /// `"default"` bật fallback phía server khi bộ lọc an toàn từ chối (chỉ realtime; Batches API không nhận).
    public var fallbacks: String?
}

public struct BatchRequestItem: Codable, Sendable {
    public var custom_id: String
    public var params: MessageRequest
}

struct BatchCreateBody: Codable, Sendable {
    var requests: [BatchRequestItem]
}

// MARK: - Response

public struct Usage: Codable, Sendable, Equatable {
    public var input_tokens: Int
    public var output_tokens: Int
    public var cache_creation_input_tokens: Int?
    public var cache_read_input_tokens: Int?

    public init(input_tokens: Int, output_tokens: Int,
                cache_creation_input_tokens: Int? = nil, cache_read_input_tokens: Int? = nil) {
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cache_creation_input_tokens = cache_creation_input_tokens
        self.cache_read_input_tokens = cache_read_input_tokens
    }
}

public struct ResponseContentBlock: Decodable, Sendable {
    public var type: String
    public var text: String?
}

public struct MessageResponse: Decodable, Sendable {
    public var model: String?
    public var content: [ResponseContentBlock]
    public var stop_reason: String?
    public var usage: Usage?

    /// Chỉ ghép các khối `text` (bỏ qua `thinking`, `fallback`…).
    public var text: String {
        content.filter { $0.type == "text" }.compactMap(\.text).joined()
    }
}

public struct APIErrorDetail: Decodable, Sendable {
    public var type: String?
    public var message: String?
}

public struct APIErrorEnvelope: Decodable, Sendable {
    public var type: String?
    public var error: APIErrorDetail?
    public var message: String?
}

public struct BatchRequestCounts: Decodable, Sendable, Equatable {
    public var processing: Int
    public var succeeded: Int
    public var errored: Int
    public var canceled: Int
    public var expired: Int
}

public struct BatchInfo: Decodable, Sendable {
    public var id: String
    /// `in_progress` | `canceling` | `ended`
    public var processing_status: String
    public var request_counts: BatchRequestCounts
    public var results_url: String?
}

public struct BatchResultBody: Decodable, Sendable {
    /// `succeeded` | `errored` | `canceled` | `expired`
    public var type: String
    public var message: MessageResponse?
    public var error: APIErrorEnvelope?
}

public struct BatchResultLine: Decodable, Sendable {
    public var custom_id: String
    public var result: BatchResultBody

    /// Kết quả trả về dạng JSONL, thứ tự bất kỳ — luôn ghép theo `custom_id`.
    public static func parseJSONL(_ data: Data) -> [BatchResultLine] {
        let decoder = JSONDecoder()
        var lines: [BatchResultLine] = []
        var start = data.startIndex
        let newline = UInt8(ascii: "\n")
        while start < data.endIndex {
            let end = data[start...].firstIndex(of: newline) ?? data.endIndex
            let slice = data[start..<end]
            if !slice.isEmpty, let line = try? decoder.decode(BatchResultLine.self, from: slice) {
                lines.append(line)
            }
            start = end < data.endIndex ? data.index(after: end) : data.endIndex
        }
        return lines
    }
}
