import Foundation
import TranslatorCore

/// Lưu mỗi tác vụ thành một file JSON trong Application Support — app bị tắt vẫn dịch tiếp được.
actor JobStore {
    private let directory: URL
    private let encoder = JSONEncoder()

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = base.appendingPathComponent("Jobs", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    nonisolated func loadAllSync() -> [TranslationJob] {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Jobs", isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        let decoder = JSONDecoder()
        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(TranslationJob.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func save(_ job: TranslationJob) {
        do {
            let data = try encoder.encode(job)
            try data.write(to: url(for: job.id), options: .atomic)
        } catch {
            print("Không lưu được tác vụ \(job.id): \(error)")
        }
    }

    func delete(_ id: UUID) {
        try? FileManager.default.removeItem(at: url(for: id))
    }

    private func url(for id: UUID) -> URL {
        directory.appendingPathComponent("\(id.uuidString).json")
    }
}
