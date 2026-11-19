import Foundation

/// Chia tài liệu dài thành các đoạn vừa với một lần gọi API.
///
/// Mỗi trang bắt đầu bằng dấu `<<<PAGE n>>>` để bản dịch giữ được vị trí trang gốc.
/// Mặc định ~9.000 ký tự tiếng Anh/đoạn (~2.300 token) — đủ ngữ cảnh để dịch mạch lạc,
/// đủ nhỏ để đầu ra tiếng Việt không chạm giới hạn `max_tokens`.
public struct Chunker: Sendable {
    public var targetChars: Int

    public init(targetChars: Int = 9_000) {
        self.targetChars = max(1_000, targetChars)
    }

    public static func pageMarker(_ page: Int) -> String { "<<<PAGE \(page)>>>" }

    public func makeChunks(pages: [String]) -> [Chunk] {
        // 1. Tách thành các mẩu (page, text) — trang quá dài được chia nhỏ.
        var pieces: [(page: Int, text: String)] = []
        for (index, raw) in pages.enumerated() {
            let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            let page = index + 1
            let parts = Chunker.split(text, limit: targetChars)
            for (i, part) in parts.enumerated() {
                let body = i == 0 ? Chunker.pageMarker(page) + "\n" + part : part
                pieces.append((page, body))
            }
        }

        // 2. Gom các mẩu thành đoạn ~targetChars.
        var chunks: [Chunk] = []
        var buffer: [String] = []
        var bufferCount = 0
        var firstPage = 0
        var lastPage = 0

        func flush() {
            guard !buffer.isEmpty else { return }
            chunks.append(Chunk(id: chunks.count, firstPage: firstPage, lastPage: lastPage,
                                source: buffer.joined(separator: "\n\n")))
            buffer.removeAll()
            bufferCount = 0
        }

        for piece in pieces {
            if !buffer.isEmpty && bufferCount + piece.text.count > targetChars {
                flush()
            }
            if buffer.isEmpty { firstPage = piece.page }
            buffer.append(piece.text)
            bufferCount += piece.text.count + 2
            lastPage = piece.page
        }
        flush()
        return chunks
    }

    /// Chia văn bản thành các phần ≤ limit ký tự, ưu tiên cắt ở ranh giới đoạn → dòng → câu → từ.
    public static func split(_ text: String, limit: Int) -> [String] {
        guard text.count > limit else { return [text] }
        let separators = ["\n\n", "\n", ". ", " "]
        for sep in separators {
            let parts = text.components(separatedBy: sep)
            guard parts.count > 1 else { continue }
            var result: [String] = []
            var current = ""
            for (i, part) in parts.enumerated() {
                let piece = i < parts.count - 1 ? part + sep : part
                if !current.isEmpty && current.count + piece.count > limit {
                    result.append(current)
                    current = ""
                }
                current += piece
            }
            if !current.isEmpty { result.append(current) }
            // Phần nào vẫn quá dài thì chia tiếp bằng dấu tách nhỏ hơn.
            return result
                .flatMap { $0.count > limit ? split($0, limit: limit) : [$0] }
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }
        // Không có dấu tách nào: cắt cứng.
        var result: [String] = []
        var start = text.startIndex
        while start < text.endIndex {
            let end = text.index(start, offsetBy: limit, limitedBy: text.endIndex) ?? text.endIndex
            result.append(String(text[start..<end]))
            start = end
        }
        return result
    }

    /// Đoạn cuối của văn bản trước đó — gửi kèm làm ngữ cảnh (không dịch) để câu văn nối liền mạch.
    public static func tail(of text: String, maxChars: Int = 800) -> String {
        guard text.count > maxChars else { return text }
        let suffix = String(text.suffix(maxChars))
        if let space = suffix.firstIndex(where: { $0.isWhitespace }) {
            return String(suffix[space...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return suffix
    }
}
