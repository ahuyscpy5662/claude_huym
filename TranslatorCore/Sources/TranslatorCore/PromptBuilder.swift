import Foundation

public struct TranslationSettings: Sendable, Equatable {
    public var model: String
    /// `low` / `medium` / `high` — độ sâu suy nghĩ của mô hình.
    public var effort: String
    public var maxTokens: Int
    public var concurrency: Int
    /// Ghi kèm thuật ngữ tiếng Anh trong ngoặc ở lần xuất hiện đầu.
    public var keepEnglishTerms: Bool

    public init(model: String = ModelCatalog.defaultModel,
                effort: String = "medium",
                maxTokens: Int = 16_000,
                concurrency: Int = 4,
                keepEnglishTerms: Bool = true) {
        self.model = model
        self.effort = effort
        self.maxTokens = maxTokens
        self.concurrency = concurrency
        self.keepEnglishTerms = keepEnglishTerms
    }
}

/// Dựng request Messages API. System prompt + bảng thuật ngữ được giữ cố định từng byte
/// và đánh dấu `cache_control` để mọi đoạn sau đoạn đầu chỉ trả giá đọc cache.
public struct PromptBuilder: Sendable {
    public var settings: TranslationSettings
    public var glossary: Glossary

    public init(settings: TranslationSettings, glossary: Glossary) {
        self.settings = settings
        self.glossary = glossary
    }

    public var systemPrompt: String {
        let termRule = settings.keepEnglishTerms
            ? "- The first time an important technical term appears in a section, write the Vietnamese term followed by the original English in parentheses, e.g. \"viêm quanh cuống (apical periodontitis)\". Afterwards use only the Vietnamese term."
            : "- Use only the Vietnamese term; do not add the English original in parentheses unless no established Vietnamese term exists."
        return """
        You are an expert medical translator specialising in Odonto-Stomatology and Oral & Maxillofacial Surgery (Răng Hàm Mặt). You translate English dental textbooks, clinical guidelines and research articles into Vietnamese for Vietnamese dentists, residents and dental students.

        The text you receive was extracted automatically from a PDF, one segment at a time, from a document that may be hundreds of pages long. Translate the segment inside <source> into Vietnamese.

        Accuracy and completeness
        - Translate everything in <source>: every sentence, list item, table cell, figure/table caption and footnote. Never summarise, skip, shorten or add content of your own.
        - Preserve the precise clinical meaning: doses, units, percentages, measurements, tooth numbers (FDI / Universal / Palmer notation), classifications and statistical values must be kept exactly.
        - If the source is cut mid-sentence at the start or end of the segment, translate the fragment as it stands; do not invent the missing part.

        Terminology
        - Use standard Vietnamese medical and dental terminology as used in Vietnamese university textbooks (Đại học Y Hà Nội, Đại học Y Dược TP.HCM) and Bộ Y tế documents.
        - The glossary below is authoritative: whenever a glossary term appears, use its Vietnamese equivalent.
        \(termRule)
        - Keep unchanged: drug names (INN), brand names, gene/protein names, Latin anatomical names when the source uses Latin, abbreviations of classifications and instruments (e.g. CBCT, MRONJ, ISO file sizes), author names, citations and reference lists.
        - "Figure", "Table", "Box", "Chapter" become "Hình", "Bảng", "Khung", "Chương" with the original numbering.

        Cleaning PDF artefacts
        - Line breaks inside paragraphs come from the PDF layout: rejoin them into natural paragraphs. Remove leftover running headers, footers and page numbers.
        - Lines like <<<PAGE 12>>> mark the start of an original page. Copy each marker unchanged on its own line, in the same position.

        Output format (lightweight Markdown, nothing else)
        - Headings: "# ", "## ", "### ". Paragraphs separated by a blank line.
        - Bulleted lists "- ", numbered lists "1. ". Tables as Markdown pipe tables with a header separator row.
        - **bold** and *italic* only where the source emphasises text.
        - Output only the Vietnamese translation. No preamble, notes, explanations or code fences.

        <glossary>
        \(glossary.promptText)
        </glossary>
        """
    }

    public func userMessage(source: String, previousContext: String?, documentTitle: String) -> String {
        var parts: [String] = []
        parts.append("<document_title>\(documentTitle)</document_title>")
        if let ctx = previousContext, !ctx.isEmpty {
            parts.append("""
            <previous_context>
            \(ctx)
            </previous_context>
            (The previous context is for continuity only — do NOT translate it.)
            """)
        }
        parts.append("<source>\n\(source)\n</source>")
        parts.append("Translate the <source> segment into Vietnamese following all the rules.")
        return parts.joined(separator: "\n\n")
    }

    public func request(source: String,
                        previousContext: String?,
                        documentTitle: String,
                        allowFallbacks: Bool) -> MessageRequest {
        let fallbacks: String? = allowFallbacks && ModelCatalog.supportsServerFallback(settings.model) ? "default" : nil
        return MessageRequest(
            model: settings.model,
            max_tokens: settings.maxTokens,
            system: [SystemBlock(text: systemPrompt, cache_control: CacheControl())],
            messages: [InputMessage(role: "user",
                                    content: userMessage(source: source,
                                                         previousContext: previousContext,
                                                         documentTitle: documentTitle))],
            output_config: OutputConfig(effort: settings.effort),
            fallbacks: fallbacks
        )
    }
}
