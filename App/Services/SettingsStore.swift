import Foundation
import TranslatorCore

@MainActor
final class SettingsStore: ObservableObject {
    private let defaults = UserDefaults.standard

    @Published var apiKey: String {
        didSet { Keychain.saveAPIKey(apiKey) }
    }
    @Published var model: String {
        didSet { defaults.set(model, forKey: "model") }
    }
    @Published var effort: String {
        didSet { defaults.set(effort, forKey: "effort") }
    }
    @Published var concurrency: Int {
        didSet { defaults.set(concurrency, forKey: "concurrency") }
    }
    @Published var chunkChars: Int {
        didSet { defaults.set(chunkChars, forKey: "chunkChars") }
    }
    @Published var keepEnglishTerms: Bool {
        didSet { defaults.set(keepEnglishTerms, forKey: "keepEnglishTerms") }
    }
    @Published var ocrEnabled: Bool {
        didSet { defaults.set(ocrEnabled, forKey: "ocrEnabled") }
    }
    @Published var glossaryText: String {
        didSet { defaults.set(glossaryText, forKey: "glossaryText") }
    }

    init() {
        apiKey = Keychain.loadAPIKey() ?? ""
        model = defaults.string(forKey: "model") ?? ModelCatalog.defaultModel
        effort = defaults.string(forKey: "effort") ?? "medium"
        concurrency = defaults.object(forKey: "concurrency") as? Int ?? 4
        chunkChars = defaults.object(forKey: "chunkChars") as? Int ?? 9_000
        keepEnglishTerms = defaults.object(forKey: "keepEnglishTerms") as? Bool ?? true
        ocrEnabled = defaults.object(forKey: "ocrEnabled") as? Bool ?? true
        glossaryText = defaults.string(forKey: "glossaryText") ?? Glossary.defaultText
    }

    var hasAPIKey: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    func translationSettings(model overrideModel: String? = nil) -> TranslationSettings {
        TranslationSettings(model: overrideModel ?? model,
                            effort: effort,
                            maxTokens: 16_000,
                            concurrency: concurrency,
                            keepEnglishTerms: keepEnglishTerms)
    }

    func promptBuilder(model overrideModel: String? = nil) -> PromptBuilder {
        PromptBuilder(settings: translationSettings(model: overrideModel),
                      glossary: Glossary.parse(glossaryText))
    }

    func resetGlossary() {
        glossaryText = Glossary.defaultText
    }
}
