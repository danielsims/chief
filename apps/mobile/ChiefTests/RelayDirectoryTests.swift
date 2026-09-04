import XCTest

@testable import Chief

final class RelayDirectoryTests: XCTestCase {
  func testForgetRemovesTheRelayAndItsWorkspaces() {
    let suite = "chief.relay-directory.test.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = RelayDirectoryStore(defaults: defaults)
    let stale = URL(string: "https://chief-relay.example.workers.dev")!
    let cloud = URL(string: "https://relay.heychief.sh")!
    store.activate(
      RelayConnectionRecord(relayURL: stale, accountURL: stale)
    )
    store.remember(
      workspaces: [
        WorkspaceSummary(
          id: "hyperfocus",
          name: "Hyperfocus",
          isActive: false,
          onboardingComplete: true
        )
      ],
      at: stale
    )
    store.remember(
      workspaces: [
        WorkspaceSummary(
          id: "chief",
          name: "Chief",
          isActive: true,
          onboardingComplete: true
        )
      ],
      at: cloud
    )

    store.forget(stale)

    XCTAssertNil(store.connection(for: stale))
    XCTAssertNil(store.location(for: "hyperfocus"))
    XCTAssertEqual(store.location(for: "chief")?.relayURL, cloud)
  }
}
