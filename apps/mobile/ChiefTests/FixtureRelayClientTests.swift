import XCTest
@testable import Chief

final class FixtureRelayClientTests: XCTestCase {
    func testFixturePersistsMessagesBeforeReturningThem() async throws {
        let relay = FixtureRelayClient()
        let message = try await relay.send(
            body: "Ship it",
            workspaceID: "chief-demo",
            conversationID: "mission-control",
            threadRootID: nil
        )
        let messages = try await relay.messages(
            workspaceID: "chief-demo",
            conversationID: "mission-control",
            after: nil
        )

        XCTAssertEqual(messages.last, message)
        XCTAssertEqual(message.body, "Ship it")
    }
}
