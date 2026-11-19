import Foundation
import PDFKit
import UIKit
import Vision

struct ExtractionResult: Sendable {
    var title: String
    var pages: [String]
    var ocrPageCount: Int
}

enum PDFExtractionError: LocalizedError {
    case cannotOpen
    case locked
    case noText

    var errorDescription: String? {
        switch self {
        case .cannotOpen: return "Không mở được file PDF."
        case .locked: return "PDF đang được đặt mật khẩu. Hãy mở khoá rồi thử lại."
        case .noText: return "Không trích xuất được chữ nào từ PDF (thử bật OCR trong Cài đặt)."
        }
    }
}

/// Trích xuất chữ từng trang bằng PDFKit; trang là ảnh scan thì nhận dạng chữ (OCR) bằng Vision.
enum PDFTextExtractor {
    /// Trang có ít hơn số ký tự này được coi là ảnh scan.
    static let minTextChars = 25

    static func extract(url: URL,
                        useOCR: Bool,
                        progress: @escaping @Sendable (_ done: Int, _ total: Int) -> Void) async throws -> ExtractionResult {
        try await Task.detached(priority: .userInitiated) {
            guard let document = PDFDocument(url: url) else { throw PDFExtractionError.cannotOpen }
            if document.isLocked { throw PDFExtractionError.locked }

            let total = document.pageCount
            var pages: [String] = []
            pages.reserveCapacity(total)
            var ocrCount = 0

            for index in 0..<total {
                try Task.checkCancellation()
                let text: String = autoreleasepool {
                    guard let page = document.page(at: index) else { return "" }
                    let embedded = page.string ?? ""
                    if useOCR && embedded.trimmingCharacters(in: .whitespacesAndNewlines).count < minTextChars {
                        let recognized = recognizeText(on: page)
                        if !recognized.isEmpty {
                            ocrCount += 1
                            return recognized
                        }
                    }
                    return embedded
                }
                pages.append(text)
                progress(index + 1, total)
            }

            guard pages.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                throw PDFExtractionError.noText
            }

            let attrTitle = document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String
            let fileTitle = url.deletingPathExtension().lastPathComponent
            let title = (attrTitle?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 } ?? fileTitle
            return ExtractionResult(title: title, pages: pages, ocrPageCount: ocrCount)
        }.value
    }

    private static func recognizeText(on page: PDFPage) -> String {
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else { return "" }
        let scale = min(3.0, 2_000 / bounds.width)
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        guard let cgImage = page.thumbnail(of: size, for: .mediaBox).cgImage else { return "" }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return ""
        }
        let observations = request.results ?? []
        return observations
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }
}
