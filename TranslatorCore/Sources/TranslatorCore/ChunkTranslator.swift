import Foundation

public struct TranslationOutput: Sendable {
    public var text: String
    public var usage: UsageTotals
}

/// Hàm gửi một request Messages — tách ra để test được không cần mạng.
public typealias MessageSender = @Sendable (MessageRequest) async throws -> MessageResponse

/// Dịch một đoạn: thử lại khi gặp 429/5xx/529, tự chia đôi đoạn nếu chạm `max_tokens`.
public struct ChunkTranslator: Sendable {
    public var prompt: PromptBuilder
    public var documentTitle: String
    public var maxAttempts: Int = 6
    let sender: MessageSender
    let sleeper: @Sendable (TimeInterval) async throws -> Void

    public init(client: AnthropicClient, prompt: PromptBuilder, documentTitle: String) {
        self.init(prompt: prompt, documentTitle: documentTitle,
                  sender: { try await client.createMessage($0) },
                  sleeper: { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) })
    }

    public init(prompt: PromptBuilder, documentTitle: String,
                sender: @escaping MessageSender,
                sleeper: @escaping @Sendable (TimeInterval) async throws -> Void) {
        self.prompt = prompt
        self.documentTitle = documentTitle
        self.sender = sender
        self.sleeper = sleeper
    }

    public func translate(source: String, previousContext: String?) async throws -> TranslationOutput {
        try await translate(source: source, previousContext: previousContext, depth: 0)
    }

    private func translate(source: String, previousContext: String?, depth: Int) async throws -> TranslationOutput {
        var usage = UsageTotals()
        do {
            let response = try await sendWithRetry(
                prompt.request(source: source, previousContext: previousContext,
                               documentTitle: documentTitle, allowFallbacks: true),
                usage: &usage)
            switch response.stop_reason {
            case "refusal":
                throw AnthropicError.refusal
            case "max_tokens":
                throw AnthropicError.maxTokens
            default:
                let text = response.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { throw AnthropicError.emptyResponse }
                return TranslationOutput(text: text, usage: usage)
            }
        } catch AnthropicError.maxTokens where depth < 3 && source.count > 1_500 {
            // Đoạn quá dài cho một lần trả lời → chia đôi và dịch tuần tự.
            let halves = Chunker.split(source, limit: source.count / 2 + 200)
            var texts: [String] = []
            var context = previousContext
            for half in halves {
                let out = try await translate(source: half, previousContext: context, depth: depth + 1)
                texts.append(out.text)
                usage.add(out.usage)
                context = Chunker.tail(of: half)
            }
            return TranslationOutput(text: texts.joined(separator: "\n\n"), usage: usage)
        }
    }

    private func sendWithRetry(_ request: MessageRequest, usage: inout UsageTotals) async throws -> MessageResponse {
        var attempt = 0
        while true {
            try Task.checkCancellation()
            do {
                let response = try await sender(request)
                if let u = response.usage { usage.add(u) }
                return response
            } catch let error as AnthropicError where error.isRetryable && attempt + 1 < maxAttempts {
                attempt += 1
                let backoff = min(60.0, pow(2.0, Double(attempt)) * 2.0) + Double.random(in: 0...1.5)
                try await sleeper(error.retryAfter ?? backoff)
            }
        }
    }
}
