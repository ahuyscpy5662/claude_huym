import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum AnthropicError: Error, LocalizedError, Sendable {
    case http(status: Int, type: String?, message: String, retryAfter: TimeInterval?)
    case refusal
    case maxTokens
    case emptyResponse
    case invalidResponse(String)
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case let .http(status, type, message, _):
            return "HTTP \(status)\(type.map { " (\($0))" } ?? ""): \(message)"
        case .refusal:
            return "Mô hình từ chối dịch đoạn này (bộ lọc an toàn)."
        case .maxTokens:
            return "Bản dịch vượt giới hạn max_tokens."
        case .emptyResponse:
            return "API trả về kết quả rỗng."
        case let .invalidResponse(s):
            return "Phản hồi không hợp lệ: \(s)"
        case let .transport(s):
            return "Lỗi mạng: \(s)"
        }
    }

    /// 429 (rate limit), 408, 409, 5xx, 529 (overloaded) và lỗi mạng → thử lại.
    public var isRetryable: Bool {
        switch self {
        case let .http(status, _, _, _):
            return status == 408 || status == 409 || status == 429 || status >= 500
        case .transport, .emptyResponse:
            return true
        default:
            return false
        }
    }

    /// Lỗi khiến mọi đoạn khác cũng sẽ thất bại → dừng cả tác vụ.
    public var isFatal: Bool {
        guard case let .http(status, _, message, _) = self else { return false }
        if status == 401 || status == 403 { return true }
        if status == 400 && message.lowercased().contains("credit balance") { return true }
        if status == 404 && message.lowercased().contains("model") { return true }
        return false
    }

    public var retryAfter: TimeInterval? {
        if case let .http(_, _, _, retryAfter) = self { return retryAfter }
        return nil
    }
}

/// Client tối giản cho Claude API qua HTTP (Swift không có SDK chính thức).
public struct AnthropicClient: Sendable {
    public static let apiVersion = "2026-10-21"
    static let fallbackBeta = "server-side-fallback-2026-07-01"

    public var apiKey: String
    public var baseURL: URL
    let session: URLSession

    public init(apiKey: String, baseURL: URL = URL(string: "https://api.anthropic.com")!) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 600     // một đoạn dài + suy nghĩ có thể mất vài phút
        config.timeoutIntervalForResource = 3_600
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)
    }

    // MARK: Messages

    public func createMessage(_ body: MessageRequest) async throws -> MessageResponse {
        var request = makeRequest(path: "/v1/messages", method: "POST")
        if body.fallbacks != nil {
            request.setValue(Self.fallbackBeta, forHTTPHeaderField: "anthropic-beta")
        }
        request.httpBody = try JSONEncoder().encode(body)
        let data = try await send(request)
        do {
            return try JSONDecoder().decode(MessageResponse.self, from: data)
        } catch {
            throw AnthropicError.invalidResponse(String(decoding: data.prefix(300), as: UTF8.self))
        }
    }

    // MARK: Message Batches

    public func createBatch(_ items: [BatchRequestItem]) async throws -> BatchInfo {
        var request = makeRequest(path: "/v1/messages/batches", method: "POST")
        request.httpBody = try JSONEncoder().encode(BatchCreateBody(requests: items))
        return try await decode(BatchInfo.self, from: send(request))
    }

    public func getBatch(id: String) async throws -> BatchInfo {
        let request = makeRequest(path: "/v1/messages/batches/\(id)", method: "GET")
        return try await decode(BatchInfo.self, from: send(request))
    }

    public func cancelBatch(id: String) async throws -> BatchInfo {
        let request = makeRequest(path: "/v1/messages/batches/\(id)/cancel", method: "POST")
        return try await decode(BatchInfo.self, from: send(request))
    }

    public func batchResults(resultsURL: String) async throws -> [BatchResultLine] {
        guard let url = URL(string: resultsURL) else {
            throw AnthropicError.invalidResponse("results_url không hợp lệ")
        }
        var request = URLRequest(url: url)
        applyHeaders(&request)
        return BatchResultLine.parseJSONL(try await send(request))
    }

    // MARK: Internals

    func makeRequest(path: String, method: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        applyHeaders(&request)
        return request
    }

    func applyHeaders(_ request: inout URLRequest) {
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue(Self.apiVersion, forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
    }

    func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw AnthropicError.invalidResponse(String(decoding: data.prefix(300), as: UTF8.self))
        }
    }

    func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw AnthropicError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw AnthropicError.invalidResponse("không phải HTTP")
        }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data)
            let message = envelope?.error?.message ?? String(decoding: data.prefix(300), as: UTF8.self)
            let retryAfter = http.value(forHTTPHeaderField: "retry-after").flatMap { TimeInterval($0) }
            throw AnthropicError.http(status: http.statusCode, type: envelope?.error?.type,
                                      message: message, retryAfter: retryAfter)
        }
        return data
    }
}
