import SwiftUI
import TranslatorCore

/// Xem bản gốc và bản dịch của một phần; sửa tay hoặc dịch lại.
struct ChunkDetailView: View {
    let jobID: UUID
    let chunkID: Int
    @EnvironmentObject private var manager: JobManager

    @State private var tab = 1
    @State private var editing = false
    @State private var draft = ""

    var body: some View {
        if let job = manager.findJob(jobID), job.chunks.indices.contains(chunkID) {
            let chunk = job.chunks[chunkID]
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    Text("Bản gốc").tag(0)
                    Text("Bản dịch").tag(1)
                }
                .pickerStyle(.segmented)
                .padding()

                if tab == 1 && editing {
                    TextEditor(text: $draft)
                        .font(.body)
                        .padding(.horizontal)
                } else {
                    ScrollView {
                        Text(tab == 0 ? chunk.source : (chunk.translation ?? "(chưa dịch)"))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                    }
                }
            }
            .navigationTitle("Phần \(chunk.id + 1) · \(chunk.pageLabel)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if tab == 1 {
                        if editing {
                            Button("Lưu") {
                                manager.updateTranslation(jobID, chunkID: chunkID, text: draft)
                                editing = false
                            }
                        } else {
                            Menu {
                                Button {
                                    draft = chunk.translation ?? ""
                                    editing = true
                                } label: { Label("Sửa bản dịch", systemImage: "pencil") }
                                Button {
                                    manager.retranslate(jobID, chunkID: chunkID)
                                } label: { Label("Dịch lại phần này", systemImage: "arrow.triangle.2.circlepath") }
                                    .disabled(manager.isRunning(jobID) || job.phase == .batchSubmitted)
                            } label: {
                                Image(systemName: "ellipsis.circle")
                            }
                        }
                    }
                }
            }
        } else {
            ContentUnavailableView("Không tìm thấy", systemImage: "doc.questionmark")
        }
    }
}
