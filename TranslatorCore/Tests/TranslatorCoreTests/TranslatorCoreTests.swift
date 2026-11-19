import XCTest
@testable import TranslatorCore

final class ChunkerTests: XCTestCase {
    func testPagesArePackedWithMarkers() {
        let pages = (1...10).map { "Page \($0) text. " + String(repeating: "word ", count: 300) }
        let chunks = Chunker(targetChars: 4_000).makeChunks(pages: pages)
        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertEqual(chunks.first?.firstPage, 1)
        XCTAssertEqual(chunks.last?.lastPage, 10)
        let all = chunks.map(\.source).joined(separator: "\n")
        for p in 1...10 { XCTAssertTrue(all.contains("<<<PAGE \(p)>>>"), "thiếu dấu trang \(p)") }
        XCTAssertEqual(chunks.map(\.id), Array(0..<chunks.count))
    }

    func testLongPageIsSplitAndNothingIsLost() {
        let paragraph = String(repeating: "Periodontal ligament fibres. ", count: 100)
        let page = Array(repeating: paragraph, count: 10).joined(separator: "\n\n")
        let chunks = Chunker(targetChars: 3_000).makeChunks(pages: [page])
        XCTAssertGreaterThan(chunks.count, 2)
        XCTAssertTrue(chunks.allSatisfy { $0.source.count <= 3_000 + 40 })
        let words = chunks.map(\.source).joined(separator: " ").components(separatedBy: "fibres").count
        XCTAssertEqual(words, page.components(separatedBy: "fibres").count)
    }

    func testEmptyPagesSkipped() {
        let chunks = Chunker().makeChunks(pages: ["", "   ", "Hello"])
        XCTAssertEqual(chunks.count, 1)
        XCTAssertEqual(chunks[0].firstPage, 3)
    }

    func testSplitWithoutSeparators() {
        let parts = Chunker.split(String(repeating: "a", count: 2_500), limit: 1_000)
        XCTAssertEqual(parts.map(\.count), [1_000, 1_000, 500])
    }
}

final class TextCleanerTests: XCTestCase {
    func testRemovesRunningHeadersAndPageNumbers() {
        let topics = ["enamel", "dentin", "pulp", "cementum", "gingiva", "maxilla", "mandible", "condyle"]
        let pages = topics.enumerated().map { i, topic in
            "CHAPTER 3  Periodontal Disease\nBody line about \(topic).\nMore on \(topic) here.\n\(i + 40)"
        }
        let cleaned = TextCleaner.clean(pages: pages)
        for text in cleaned {
            XCTAssertFalse(text.contains("CHAPTER 3"))
            XCTAssertTrue(text.hasPrefix("Body line about"))
            XCTAssertTrue(text.hasSuffix("here."))
        }
    }

    func testDehyphenation() {
        let out = TextCleaner.joinLines(["The peri-", "odontal ligament", "Anti-", "Inflammatory"])
        XCTAssertEqual(out, "The periodontal ligament\nAnti-\nInflammatory")
    }
}

final class MarkdownLiteTests: XCTestCase {
    func testBlocks() {
        let md = """
        <<<PAGE 5>>>
        # Chương 3
        Đoạn văn **đậm** và *nghiêng*
        tiếp tục dòng.

        - Mục một
        1. Bước một

        | Cột A | Cột B |
        |---|---|
        | 1 | 2 |
        """
        let blocks = MarkdownLite.parse(md)
        XCTAssertEqual(blocks.first, .pageMarker(5))
        XCTAssertEqual(blocks[1], .heading(level: 1, runs: [InlineRun(text: "Chương 3")]))
        guard case let .paragraph(runs) = blocks[2] else { return XCTFail("cần paragraph") }
        XCTAssertEqual(MarkdownLite.plainText(runs), "Đoạn văn đậm và nghiêng tiếp tục dòng.")
        XCTAssertTrue(runs.contains(InlineRun(text: "đậm", bold: true)))
        XCTAssertTrue(runs.contains(InlineRun(text: "nghiêng", italic: true)))
        XCTAssertEqual(blocks[3], .listItem(marker: "•", runs: [InlineRun(text: "Mục một")], indent: 0))
        XCTAssertEqual(blocks[4], .listItem(marker: "1.", runs: [InlineRun(text: "Bước một")], indent: 0))
        guard case let .table(header, rows) = blocks[5] else { return XCTFail("cần table") }
        XCTAssertEqual(header.count, 2)
        XCTAssertEqual(rows.count, 1)
    }

    func testLoneAsteriskIsLiteral() {
        XCTAssertEqual(MarkdownLite.plainText(MarkdownLite.inline("5 * 3 = 15")), "5 * 3 = 15")
    }

    func testInlinePageMarker() {
        let blocks = MarkdownLite.parse("cuối trang <<<PAGE 9>>> đầu trang")
        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[1], .pageMarker(9))
    }
}

final class PromptAndAPITests: XCTestCase {
    func testRequestEncodingAndCacheStability() throws {
        let builder = PromptBuilder(settings: TranslationSettings(),
                                    glossary: Glossary.parse(Glossary.defaultText))
        let a = builder.request(source: "A", previousContext: nil, documentTitle: "Doc", allowFallbacks: true)
        let b = builder.request(source: "B", previousContext: "ctx", documentTitle: "Doc", allowFallbacks: false)
        XCTAssertEqual(a.system, b.system, "system prompt phải giống hệt nhau để cache")
        XCTAssertEqual(a.fallbacks, "default")
        XCTAssertNil(b.fallbacks)

        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(b)) as! [String: Any]
        XCTAssertNil(json["fallbacks"])
        XCTAssertNil(json["thinking"])
        let system = json["system"] as! [[String: Any]]
        XCTAssertEqual((system[0]["cache_control"] as! [String: String])["type"], "ephemeral")
        XCTAssertEqual((json["output_config"] as! [String: String])["effort"], "medium")
    }

    func testGlossaryParse() {
        let g = Glossary.parse("# c\nenamel\tmen răng\ndentin = ngà răng\nbad line")
        XCTAssertEqual(g.entries.count, 2)
        XCTAssertEqual(g.entries[1].vietnamese, "ngà răng")
        XCTAssertGreaterThan(Glossary.parse(Glossary.defaultText).entries.count, 150)
    }

    func testBatchJSONL() {
        let jsonl = """
        {"custom_id":"c1","result":{"type":"succeeded","message":{"model":"claude-opus-5-5","content":[{"type":"thinking","thinking":""},{"type":"text","text":"Xin chào"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5}}}}
        {"custom_id":"c0","result":{"type":"errored","error":{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}}}

        """
        let lines = BatchResultLine.parseJSONL(Data(jsonl.utf8))
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(lines[0].result.message?.text, "Xin chào")
        XCTAssertEqual(lines[1].result.error?.error?.type, "overloaded_error")
    }
}

final class ChunkTranslatorTests: XCTestCase {
    private static func response(_ text: String, stop: String = "end_turn") -> MessageResponse {
        MessageResponse(model: "m", content: [ResponseContentBlock(type: "text", text: text)],
                        stop_reason: stop, usage: Usage(input_tokens: 1, output_tokens: 1))
    }

    func testRetriesOnOverload() async throws {
        let counter = Counter()
        let translator = ChunkTranslator(
            prompt: PromptBuilder(settings: TranslationSettings(), glossary: Glossary(entries: [])),
            documentTitle: "t",
            sender: { _ in
                if await counter.increment() < 3 {
                    throw AnthropicError.http(status: 529, type: "overloaded_error", message: "x", retryAfter: nil)
                }
                return ChunkTranslatorTests.response("ok")
            },
            sleeper: { _ in })
        let out = try await translator.translate(source: "hello", previousContext: nil)
        XCTAssertEqual(out.text, "ok")
        let calls = await counter.value
        XCTAssertEqual(calls, 3)
    }

    func testSplitsOnMaxTokens() async throws {
        let source = String(repeating: "Sentence about enamel. ", count: 200)
        let translator = ChunkTranslator(
            prompt: PromptBuilder(settings: TranslationSettings(), glossary: Glossary(entries: [])),
            documentTitle: "t",
            sender: { req in
                let len = req.messages[0].content.count
                return len > 4_000 ? ChunkTranslatorTests.response("", stop: "max_tokens") : ChunkTranslatorTests.response("phần")
            },
            sleeper: { _ in })
        let out = try await translator.translate(source: source, previousContext: nil)
        XCTAssertTrue(out.text.contains("phần\n\nphần"))
    }

    func testAuthErrorIsFatalNotRetried() async {
        let counter = Counter()
        let translator = ChunkTranslator(
            prompt: PromptBuilder(settings: TranslationSettings(), glossary: Glossary(entries: [])),
            documentTitle: "t",
            sender: { _ in
                _ = await counter.increment()
                throw AnthropicError.http(status: 401, type: "authentication_error", message: "bad key", retryAfter: nil)
            },
            sleeper: { _ in })
        do {
            _ = try await translator.translate(source: "x", previousContext: nil)
            XCTFail("phải ném lỗi")
        } catch let error as AnthropicError {
            XCTAssertTrue(error.isFatal)
        } catch { XCTFail("sai loại lỗi") }
        let calls = await counter.value
        XCTAssertEqual(calls, 1)
    }
}

actor Counter {
    var value = 0
    func increment() -> Int { value += 1; return value }
}
