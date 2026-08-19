import XCTest
@testable import Chief

final class OnboardingDraftTests: XCTestCase {
    func testCompletionRequiresOnlyTheFourOnboardingInputs() {
        var draft = OnboardingDraft()
        XCTAssertFalse(draft.canContinue)
        draft.runtime = .cloud
        draft.inferenceProvider = .openCodeGo
        draft.companyName = "Chief"
        XCTAssertTrue(draft.canContinue)
    }

    func testAppSelectionsDoNotReorder() {
        var draft = OnboardingDraft()
        draft.selectedApps.insert("Vercel")
        draft.selectedApps.insert("GitHub")
        XCTAssertEqual(draft.selectedApps, ["Vercel", "GitHub"])
    }

    func testOnDeviceSelectionCarriesADeviceModel() {
        var draft = OnboardingDraft()
        XCTAssertNil(draft.deviceModelID)
        draft.deviceModelID = "gemma-4-e2b"
        draft.inferenceModel = "gemma-4-e2b"
        XCTAssertEqual(draft.deviceModelID, "gemma-4-e2b")
    }
}

@MainActor
final class DeviceModelCatalogTests: XCTestCase {
    func testSupportedModelsMatchTheDurableAgentGemmaFamily() {
        let models = OnDeviceModelStore.models
        XCTAssertEqual(models.map(\.id), ["gemma-4-e2b", "gemma-4-e4b"])
        XCTAssertTrue(models.allSatisfy { $0.remoteURL.scheme == "https" })
        XCTAssertTrue(models.allSatisfy { $0.bytes > 0 })
    }

    func testDownloadedStateReflectsTheFileOnDisk() throws {
        let directory = FileManager.default.temporaryDirectory
          .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OnDeviceModelStore(
          fileManager: .default,
          session: .shared,
          modelsDirectory: directory
        )
        let model = try XCTUnwrap(OnDeviceModelStore.models.first)
        XCTAssertFalse(store.isDownloaded(model.id))
        try FileManager.default.createDirectory(
          at: directory,
          withIntermediateDirectories: true
        )
        FileManager.default.createFile(
          atPath: store.fileURL(for: model).path,
          contents: Data()
        )
        XCTAssertTrue(store.isDownloaded(model.id))
        XCTAssertFalse(store.isDownloading(model.id))
    }
}

@MainActor
final class PluginCatalogRankingTests: XCTestCase {
    func testPriorityDomainsComeFirstInTheRankedList() {
        let options = [
            PluginOption(id: "zapier", name: "Zapier", domain: "zapier.com"),
            PluginOption(id: "slack", name: "Slack", domain: "slack.com"),
            PluginOption(
                id: "workspace", name: "Google Workspace",
                domain: "workspace.google.com"
            ),
            PluginOption(id: "github", name: "GitHub", domain: "github.com"),
        ]
        let ranked = PluginCatalogClient.ranked(options)
        XCTAssertEqual(
            ranked.map(\.name),
            ["Google Workspace", "Slack", "GitHub", "Zapier"]
        )
    }

    func testFeaturedProvidersRankAboveUnfeaturedAfterPriority() {
        let options = [
            PluginOption(id: "obscure", name: "Obscure", domain: "obscure.example"),
            PluginOption(
                id: "hot", name: "Popular Tool", domain: "popular.example",
                popularity: 50_000
            ),
        ]
        let ranked = PluginCatalogClient.ranked(options)
        XCTAssertEqual(ranked.map(\.name), ["Popular Tool", "Obscure"])
    }
}
