import CoreText
import UIKit
import TranslatorCore

/// Dựng file PDF tiếng Việt (A4) từ bản dịch Markdown bằng CoreText — chạy được với tài liệu hàng nghìn trang.
struct PDFExporter {
    let pageSize = CGSize(width: 595.2, height: 841.8) // A4 (pt)
    let margin = UIEdgeInsets(top: 60, left: 58, bottom: 66, right: 58)

    private var contentWidth: CGFloat { pageSize.width - margin.left - margin.right }

    // MARK: Fonts (Times New Roman và SF đều hỗ trợ đầy đủ dấu tiếng Việt)

    private func bodyFont(size: CGFloat = 11.5, bold: Bool = false, italic: Bool = false) -> UIFont {
        let name: String
        switch (bold, italic) {
        case (true, true): name = "TimesNewRomanPS-BoldItalicMT"
        case (true, false): name = "TimesNewRomanPS-BoldMT"
        case (false, true): name = "TimesNewRomanPS-ItalicMT"
        case (false, false): name = "TimesNewRomanPSMT"
        }
        if let font = UIFont(name: name, size: size) { return font }
        var traits: UIFontDescriptor.SymbolicTraits = []
        if bold { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }
        let base = UIFont.systemFont(ofSize: size)
        let descriptor = base.fontDescriptor.withSymbolicTraits(traits) ?? base.fontDescriptor
        return UIFont(descriptor: descriptor, size: size)
    }

    private func headingFont(level: Int) -> UIFont {
        let sizes: [CGFloat] = [20, 16, 13.5, 12.5, 12, 12]
        return UIFont.systemFont(ofSize: sizes[min(max(level, 1), 6) - 1], weight: .bold)
    }

    // MARK: Export

    func export(job: TranslationJob, to url: URL) throws {
        let blocks = job.chunks.sorted { $0.id < $1.id }.flatMap { chunk -> [MDBlock] in
            if chunk.status == .done, let text = chunk.translation {
                return MarkdownLite.parse(text)
            }
            return [.paragraph([InlineRun(text: "[Chưa dịch: \(chunk.pageLabel.lowercased()) của bản gốc]", italic: true)])]
        }
        let segments = makeSegments(blocks)

        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [
            kCGPDFContextTitle as String: job.title + " (bản dịch tiếng Việt)",
            kCGPDFContextCreator as String: "Dịch tài liệu RHM",
        ]
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize), format: format)

        try renderer.writePDF(to: url) { context in
            var pageNumber = 0
            func beginPage() {
                context.beginPage()
                pageNumber += 1
                drawFooter(pageNumber)
            }

            beginPage()
            drawTitlePage(job: job)

            // `cursorY` = vị trí (toạ độ UIKit, từ trên xuống) nơi nội dung tiếp theo bắt đầu; nil = cần trang mới.
            var cursorY: CGFloat? = nil
            for segment in segments {
                let framesetter = CTFramesetterCreateWithAttributedString(segment as CFAttributedString)
                var location = 0
                while location < segment.length {
                    if cursorY == nil {
                        beginPage()
                        cursorY = margin.top
                    }
                    let top = cursorY!
                    let height = pageSize.height - margin.bottom - top
                    if height < 36 {
                        cursorY = nil
                        continue
                    }
                    // CoreText dùng gốc toạ độ dưới-trái → đổi sang hệ đó.
                    let ctRect = CGRect(x: margin.left, y: margin.bottom, width: contentWidth, height: height)
                    let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: location, length: 0),
                                                         CGPath(rect: ctRect, transform: nil), nil)
                    let visible = CTFrameGetVisibleStringRange(frame)

                    if visible.length == 0 {
                        if top <= margin.top + 0.5 {
                            location = segment.length // không thể xảy ra trong thực tế; tránh lặp vô hạn
                        }
                        cursorY = nil
                        continue
                    }

                    let cg = context.cgContext
                    cg.saveGState()
                    cg.textMatrix = .identity
                    cg.translateBy(x: 0, y: pageSize.height)
                    cg.scaleBy(x: 1, y: -1)
                    CTFrameDraw(frame, cg)
                    cg.restoreGState()

                    location += visible.length
                    if location >= segment.length {
                        cursorY = top + usedHeight(of: frame, frameHeight: height) + 8
                    } else {
                        cursorY = nil
                    }
                }
            }
        }
    }

    /// Chiều cao thực đã dùng trong khung (để đoạn kế tiếp nối ngay bên dưới, không bỏ trống trang).
    private func usedHeight(of frame: CTFrame, frameHeight: CGFloat) -> CGFloat {
        let lines = CTFrameGetLines(frame) as! [CTLine]
        guard let last = lines.last else { return 0 }
        var origins = [CGPoint](repeating: .zero, count: lines.count)
        CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
        var descent: CGFloat = 0
        CTLineGetTypographicBounds(last, nil, &descent, nil)
        return frameHeight - (origins[lines.count - 1].y - descent)
    }

    // MARK: Page furniture

    private func drawFooter(_ number: Int) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 9),
            .foregroundColor: UIColor.gray,
        ]
        let text = "\(number)" as NSString
        let size = text.size(withAttributes: attrs)
        text.draw(at: CGPoint(x: (pageSize.width - size.width) / 2, y: pageSize.height - margin.bottom / 2 - size.height / 2),
                  withAttributes: attrs)
    }

    private func drawTitlePage(job: TranslationJob) {
        let center = NSMutableParagraphStyle()
        center.alignment = .center
        let title = NSAttributedString(string: job.title, attributes: [
            .font: UIFont.systemFont(ofSize: 24, weight: .bold),
            .paragraphStyle: center,
        ])
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "vi_VN")
        formatter.dateStyle = .long
        let subtitleText = """
        Bản dịch tiếng Việt — chuyên ngành Răng Hàm Mặt

        Bản gốc: \(job.pageCount) trang · Dịch máy bằng \(ModelCatalog.info(job.model).displayName)
        Ngày xuất: \(formatter.string(from: Date()))
        \(job.isComplete ? "" : "\n⚠︎ Bản dịch chưa hoàn tất: \(job.doneCount)/\(job.chunks.count) phần đã dịch.")

        Lưu ý: đây là bản dịch máy, cần được chuyên gia hiệu đính trước khi dùng cho mục đích lâm sàng hoặc xuất bản.
        """
        let subtitle = NSAttributedString(string: subtitleText, attributes: [
            .font: UIFont.systemFont(ofSize: 12),
            .foregroundColor: UIColor.darkGray,
            .paragraphStyle: center,
        ])
        let width = contentWidth
        title.draw(with: CGRect(x: margin.left, y: 260, width: width, height: 200),
                   options: [.usesLineFragmentOrigin], context: nil)
        let titleHeight = title.boundingRect(with: CGSize(width: width, height: 400),
                                             options: [.usesLineFragmentOrigin], context: nil).height
        subtitle.draw(with: CGRect(x: margin.left, y: 260 + titleHeight + 30, width: width, height: 300),
                      options: [.usesLineFragmentOrigin], context: nil)
    }

    // MARK: Markdown → NSAttributedString

    /// Gom các khối thành từng phần ~30.000 ký tự để CoreText xử lý nhẹ nhàng với tài liệu rất dài.
    private func makeSegments(_ blocks: [MDBlock]) -> [NSAttributedString] {
        var segments: [NSAttributedString] = []
        var current = NSMutableAttributedString()
        for block in blocks {
            // Không để heading đứng cuối một phần (tránh tách heading khỏi đoạn văn ngay sau).
            let isHeading: Bool
            if case .heading = block { isHeading = true } else { isHeading = false }
            if current.length > 30_000 && !isHeading {
                segments.append(current)
                current = NSMutableAttributedString()
            }
            current.append(attributed(block))
        }
        if current.length > 0 { segments.append(current) }
        return segments
    }

    private func paragraphStyle(spacingBefore: CGFloat = 0, spacingAfter: CGFloat = 6,
                                indent: CGFloat = 0, headIndent: CGFloat? = nil,
                                alignment: NSTextAlignment = .justified) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.alignment = alignment
        style.paragraphSpacingBefore = spacingBefore
        style.paragraphSpacing = spacingAfter
        style.firstLineHeadIndent = indent
        style.headIndent = headIndent ?? indent
        style.lineHeightMultiple = 1.12
        style.hyphenationFactor = 0
        return style
    }

    private func runs(_ runs: [InlineRun], size: CGFloat = 11.5, color: UIColor = .black,
                      forceBold: Bool = false, style: NSParagraphStyle) -> NSMutableAttributedString {
        let result = NSMutableAttributedString()
        for run in runs {
            result.append(NSAttributedString(string: run.text, attributes: [
                .font: bodyFont(size: size, bold: run.bold || forceBold, italic: run.italic),
                .foregroundColor: color,
                .paragraphStyle: style,
            ]))
        }
        result.append(NSAttributedString(string: "\n", attributes: [
            .font: bodyFont(size: size), .paragraphStyle: style,
        ]))
        return result
    }

    private func attributed(_ block: MDBlock) -> NSAttributedString {
        switch block {
        case let .heading(level, inline):
            let style = paragraphStyle(spacingBefore: level == 1 ? 18 : 12, spacingAfter: 6, alignment: .left)
            let text = MarkdownLite.plainText(inline)
            return NSAttributedString(string: text + "\n", attributes: [
                .font: headingFont(level: level),
                .foregroundColor: UIColor(red: 0.05, green: 0.25, blue: 0.45, alpha: 1),
                .paragraphStyle: style,
            ])

        case let .paragraph(inline):
            return runs(inline, style: paragraphStyle())

        case let .listItem(marker, inline, indent):
            let left = CGFloat(indent) * 16
            let style = paragraphStyle(spacingAfter: 3, indent: left, headIndent: left + 18, alignment: .left)
            let mutable = NSMutableParagraphStyle()
            mutable.setParagraphStyle(style)
            mutable.tabStops = [NSTextTab(textAlignment: .left, location: left + 18)]
            let line = [InlineRun(text: marker + "\t")] + inline
            return runs(line, style: mutable)

        case let .table(header, rows):
            // Bảng hiển thị dạng từng hàng, các ô ngăn cách bằng "│" (giữ trọn nội dung, không cắt chữ).
            let result = NSMutableAttributedString()
            let style = paragraphStyle(spacingAfter: 2, indent: 6, headIndent: 14, alignment: .left)
            let separator = [InlineRun(text: "  │  ")]
            func join(_ cells: [[InlineRun]]) -> [InlineRun] {
                cells.enumerated().flatMap { i, cell in i == 0 ? cell : separator + cell }
            }
            result.append(runs(join(header), size: 10, color: .black, forceBold: true, style: style))
            for row in rows {
                result.append(runs(join(row), size: 10, style: style))
            }
            result.append(NSAttributedString(string: "\n", attributes: [.font: bodyFont(size: 4)]))
            return result

        case let .pageMarker(page):
            let style = paragraphStyle(spacingBefore: 4, spacingAfter: 4, alignment: .center)
            return NSAttributedString(string: "— trang gốc \(page) —\n", attributes: [
                .font: UIFont.systemFont(ofSize: 7.5),
                .foregroundColor: UIColor.lightGray,
                .paragraphStyle: style,
            ])

        case .rule:
            let style = paragraphStyle(spacingBefore: 4, spacingAfter: 4, alignment: .center)
            return NSAttributedString(string: "* * *\n", attributes: [
                .font: bodyFont(size: 10), .foregroundColor: UIColor.gray, .paragraphStyle: style,
            ])
        }
    }
}
