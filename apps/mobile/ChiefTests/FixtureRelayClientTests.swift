import XCTest
@testable import Chief

final class FixtureRelayClientTests: XCTestCase {
    func testFixturePersistsMessagesBeforeReturningThem() async throws {
        let relay = FixtureRelayClient()
        let message = try await relay.send(
            messageID: "message-client-owned",
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
        XCTAssertEqual(message.id, "message-client-owned")
        XCTAssertEqual(message.body, "Ship it")
    }
}
