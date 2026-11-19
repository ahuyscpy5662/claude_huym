import Foundation

public struct InlineRun: Equatable, Sendable {
    public var text: String
    public var bold: Bool
    public var italic: Bool

    public init(text: String, bold: Bool = false, italic: Bool = false) {
        self.text = text
        self.bold = bold
        self.italic = italic
    }
}

public enum MDBlock: Equatable, Sendable {
    case heading(level: Int, runs: [InlineRun])
    case paragraph([InlineRun])
    case listItem(marker: String, runs: [InlineRun], indent: Int)
    case table(header: [[InlineRun]], rows: [[[InlineRun]]])
    case pageMarker(Int)
    case rule
}

/// Bộ phân tích Markdown tối giản cho đầu ra của mô hình (heading, đoạn, danh sách, bảng, đậm/nghiêng).
public enum MarkdownLite {

    public static func parse(_ markdown: String) -> [MDBlock] {
        var blocks: [MDBlock] = []
        var paragraph: [String] = []
        let lines = stripCodeFences(markdown).components(separatedBy: "\n")

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            let text = paragraph.joined(separator: " ").trimmingCharacters(in: .whitespaces)
            if !text.isEmpty { blocks.append(.paragraph(inline(text))) }
            paragraph.removeAll()
        }

        var i = 0
        while i < lines.count {
            let raw = lines[i]
            let line = raw.trimmingCharacters(in: .whitespaces)

            if line.isEmpty {
                flushParagraph()
                i += 1
                continue
            }
            if let page = pageMarker(line) {
                flushParagraph()
                blocks.append(.pageMarker(page))
                i += 1
                continue
            }
            if let h = heading(line) {
                flushParagraph()
                blocks.append(.heading(level: h.level, runs: inline(h.text)))
                i += 1
                continue
            }
            if line == "---" || line == "***" || line == "___" {
                flushParagraph()
                blocks.append(.rule)
                i += 1
                continue
            }
            if line.hasPrefix("|"), i + 1 < lines.count, isTableSeparator(lines[i + 1]) {
                flushParagraph()
                let header = cells(line)
                var rows: [[[InlineRun]]] = []
                i += 2
                while i < lines.count {
                    let row = lines[i].trimmingCharacters(in: .whitespaces)
                    guard row.hasPrefix("|") else { break }
                    rows.append(cells(row))
                    i += 1
                }
                blocks.append(.table(header: header, rows: rows))
                continue
            }
            if let item = listItem(line) {
                flushParagraph()
                let indent = raw.prefix(while: { $0 == " " }).count / 2
                blocks.append(.listItem(marker: item.marker, runs: inline(item.text), indent: min(indent, 3)))
                i += 1
                continue
            }
            // Dấu trang lọt vào giữa đoạn → tách ra.
            if line.contains("<<<PAGE") {
                flushParagraph()
                let pieces = splitInlineMarkers(line)
                for piece in pieces {
                    if let page = pageMarker(piece) { blocks.append(.pageMarker(page)) }
                    else if !piece.isEmpty { blocks.append(.paragraph(inline(piece))) }
                }
                i += 1
                continue
            }
            paragraph.append(line)
            i += 1
        }
        flushParagraph()
        return blocks
    }

    // MARK: - Inline

    /// `**đậm**`, `*nghiêng*`, `***đậm nghiêng***`. Ký tự `\*` được giữ nguyên.
    public static func inline(_ text: String) -> [InlineRun] {
        var runs: [InlineRun] = []
        var current = ""
        var bold = false
        var italic = false
        let chars = Array(text)
        var i = 0

        func push() {
            guard !current.isEmpty else { return }
            if let last = runs.last, last.bold == bold, last.italic == italic {
                runs[runs.count - 1].text += current
            } else {
                runs.append(InlineRun(text: current, bold: bold, italic: italic))
            }
            current = ""
        }

        while i < chars.count {
            let c = chars[i]
            if c == "\\", i + 1 < chars.count, chars[i + 1] == "*" {
                current.append("*")
                i += 2
                continue
            }
            if c == "*" {
                var n = 0
                while i + n < chars.count, chars[i + n] == "*" { n += 1 }
                // "*" đứng một mình giữa khoảng trắng (vd "5 * 3") là ký tự thường.
                let prevSpace = i == 0 || chars[i - 1].isWhitespace
                let nextSpace = i + n >= chars.count || chars[i + n].isWhitespace
                if prevSpace && nextSpace {
                    current.append(String(repeating: "*", count: n))
                    i += n
                    continue
                }
                push()
                if n >= 3 { bold.toggle(); italic.toggle() }
                else if n == 2 { bold.toggle() }
                else { italic.toggle() }
                i += n
                continue
            }
            current.append(c)
            i += 1
        }
        push()
        return runs
    }

    public static func plainText(_ runs: [InlineRun]) -> String {
        runs.map(\.text).joined()
    }

    // MARK: - Helpers

    static func stripCodeFences(_ s: String) -> String {
        s.components(separatedBy: "\n")
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("```") }
            .joined(separator: "\n")
    }

    static func pageMarker(_ line: String) -> Int? {
        let s = line.trimmingCharacters(in: .whitespaces)
        guard s.hasPrefix("<<<PAGE "), s.hasSuffix(">>>") else { return nil }
        let number = s.dropFirst("<<<PAGE ".count).dropLast(3)
        return Int(number.trimmingCharacters(in: .whitespaces))
    }

    static func splitInlineMarkers(_ line: String) -> [String] {
        var result: [String] = []
        var rest = Substring(line)
        while let start = rest.range(of: "<<<PAGE ") {
            let before = rest[..<start.lowerBound].trimmingCharacters(in: .whitespaces)
            if !before.isEmpty { result.append(before) }
            guard let end = rest[start.upperBound...].range(of: ">>>") else {
                result.append(String(rest[start.lowerBound...]))
                return result
            }
            result.append(String(rest[start.lowerBound..<end.upperBound]))
            rest = rest[end.upperBound...]
        }
        let tail = rest.trimmingCharacters(in: .whitespaces)
        if !tail.isEmpty { result.append(tail) }
        return result
    }

    static func heading(_ line: String) -> (level: Int, text: String)? {
        let hashes = line.prefix(while: { $0 == "#" }).count
        guard (1...6).contains(hashes) else { return nil }
        let rest = line.dropFirst(hashes)
        guard rest.first == " " else { return nil }
        return (hashes, rest.trimmingCharacters(in: .whitespaces))
    }

    static func listItem(_ line: String) -> (marker: String, text: String)? {
        for bullet in ["- ", "* ", "• ", "+ "] where line.hasPrefix(bullet) {
            return ("•", String(line.dropFirst(bullet.count)).trimmingCharacters(in: .whitespaces))
        }
        let digits = line.prefix(while: { $0.isNumber || ($0.isLetter && $0.isLowercase && $0.isASCII) })
        guard !digits.isEmpty, digits.count <= 4 else { return nil }
        let after = line.dropFirst(digits.count)
        guard let delimiter = after.first, delimiter == "." || delimiter == ")",
              after.dropFirst().first == " " else { return nil }
        // Chỉ nhận chữ cái đơn (a., b.) hoặc số (1., 12.)
        if digits.contains(where: { $0.isLetter }) && digits.count > 1 { return nil }
        return (String(digits) + String(delimiter),
                String(after.dropFirst(2)).trimmingCharacters(in: .whitespaces))
    }

    static func isTableSeparator(_ line: String) -> Bool {
        let s = line.trimmingCharacters(in: .whitespaces)
        guard s.contains("-") else { return false }
        return s.allSatisfy { "|-: ".contains($0) }
    }

    static func cells(_ line: String) -> [[InlineRun]] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|") { s.removeLast() }
        return s.components(separatedBy: "|").map { inline($0.trimmingCharacters(in: .whitespaces)) }
    }
}
