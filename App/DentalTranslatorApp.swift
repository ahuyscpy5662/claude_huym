import SwiftUI

@main
struct DentalTranslatorApp: App {
    @StateObject private var settings: SettingsStore
    @StateObject private var manager: JobManager
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let settings = SettingsStore()
        _settings = StateObject(wrappedValue: settings)
        _manager = StateObject(wrappedValue: JobManager(settings: settings))
    }

    var body: some Scene {
        WindowGroup {
            JobListView()
                .environmentObject(settings)
                .environmentObject(manager)
        }
        .onChange(of: scenePhase) { _, phase in
            manager.handleScenePhase(phase)
        }
    }
}
