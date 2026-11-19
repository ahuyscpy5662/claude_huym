import Foundation

/// Làm sạch văn bản trích xuất từ PDF: bỏ header/footer lặp lại, số trang, nối từ bị gạch nối cuối dòng.
public enum TextCleaner {

    public static func clean(pages: [String]) -> [String] {
        let pageLines = pages.map(normalizedLines)
        let repeated = repeatedEdgeSignatures(pageLines)
        return pageLines.map { lines in
            var lines = lines
            stripEdges(&lines, repeated: repeated)
            return joinLines(lines)
        }
    }

    // MARK: - Steps

    static func normalizedLines(_ text: String) -> [String] {
        text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\u{00A0}", with: " ")
            .replacingOccurrences(of: "\u{FB01}", with: "fi")
            .replacingOccurrences(of: "\u{FB02}", with: "fl")
            .replacingOccurrences(of: "\u{00AD}", with: "") // soft hyphen
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// Chữ ký của một dòng: chữ thường, số thay bằng '#', gộp khoảng trắng.
    static func signature(_ line: String) -> String {
        var out = ""
        var lastSpace = false
        for ch in line.lowercased() {
            if ch.isNumber {
                if !out.hasSuffix("#") { out.append("#") }
                lastSpace = false
            } else if ch.isWhitespace {
                if !lastSpace { out.append(" ") }
                lastSpace = true
            } else {
                out.append(ch)
                lastSpace = false
            }
        }
        return out.trimmingCharacters(in: .whitespaces)
    }

    static func isPageNumberLine(_ line: String) -> Bool {
        let s = line.lowercased().trimmingCharacters(in: .whitespaces)
        if s.isEmpty || s.count > 12 { return false }
        let stripped = s.replacingOccurrences(of: "page", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: " -–—|"))
        if stripped.isEmpty { return false }
        if stripped.allSatisfy({ $0.isNumber }) { return true }
        // Số La Mã (trang lời nói đầu)
        return stripped.count <= 6 && stripped.allSatisfy { "ivxlc".contains($0) }
    }

    /// Các dòng nằm ở 2 dòng đầu/cuối trang và xuất hiện lặp lại ở nhiều trang → header/footer.
    static func repeatedEdgeSignatures(_ pages: [[String]]) -> Set<String> {
        guard pages.count >= 4 else { return [] }
        var counts: [String: Int] = [:]
        for lines in pages {
            let nonEmpty = lines.filter { !$0.isEmpty }
            let edges = Set(Array(nonEmpty.prefix(2)) + Array(nonEmpty.suffix(2)))
            for line in edges {
                let sig = signature(line)
                guard sig.count >= 3 else { continue }
                counts[sig, default: 0] += 1
            }
        }
        let threshold = max(3, Int(Double(pages.count) * 0.3))
        return Set(counts.filter { $0.value >= threshold }.map(\.key))
    }

    static func stripEdges(_ lines: inout [String], repeated: Set<String>) {
        func shouldStrip(_ line: String) -> Bool {
            isPageNumberLine(line) || repeated.contains(signature(line))
        }
        for _ in 0..<2 {
            while let first = lines.first, first.isEmpty { lines.removeFirst() }
            if let first = lines.first, shouldStrip(first) { lines.removeFirst() }
        }
        for _ in 0..<2 {
            while let last = lines.last, last.isEmpty { lines.removeLast() }
            if let last = lines.last, shouldStrip(last) { lines.removeLast() }
        }
    }

    /// Giữ nguyên xuống dòng (giúp mô hình nhận ra danh sách/bảng), chỉ nối từ bị gạch nối
    /// cuối dòng ("peri-\nodontal" → "periodontal") và gộp các dòng trống liên tiếp.
    static func joinLines(_ lines: [String]) -> String {
        var result: [String] = []
        for line in lines {
            if let prev = result.last,
               prev.hasSuffix("-"),
               prev.dropLast().last?.isLetter == true,
               let first = line.first, first.isLowercase {
                result[result.count - 1] = String(prev.dropLast()) + line
            } else {
                result.append(line)
            }
        }
        var text = result.joined(separator: "\n")
        while text.contains("\n\n\n") {
            text = text.replacingOccurrences(of: "\n\n\n", with: "\n\n")
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
