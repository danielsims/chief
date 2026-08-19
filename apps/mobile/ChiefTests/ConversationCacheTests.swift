import XCTest
@testable import Chief

@MainActor
final class ConversationCacheTests: XCTestCase {
    func testMessagesNeverCrossWorkspaceBoundaries() {
        let cache = ConversationCache()
        cache.merge(message(id: "a", workspace: "workspace-a", sequence: 1))
        cache.merge(message(id: "b", workspace: "workspace-b", sequence: 1))

        XCTAssertEqual(cache.messages(workspaceID: "workspace-a", conversationID: "general").map(\.id), ["a"])
        XCTAssertEqual(cache.messages(workspaceID: "workspace-b", conversationID: "general").map(\.id), ["b"])
    }

    func testMergeOrdersBySequenceAndDeduplicatesReceipts() {
        let cache = ConversationCache()
        cache.merge(message(id: "second", workspace: "workspace-a", sequence: 2))
        cache.merge(message(id: "first", workspace: "workspace-a", sequence: 1))
        cache.merge(message(id: "second", workspace: "workspace-a", sequence: 2))

        XCTAssertEqual(
            cache.messages(workspaceID: "workspace-a", conversationID: "general").map(\.id),
            ["first", "second"]
        )
    }

    private func message(id: String, workspace: String, sequence: Int) -> ConversationMessage {
        ConversationMessage(
            id: id,
            workspaceID: workspace,
            conversationID: "general",
            threadRootID: nil,
            author: .system,
            body: id,
            components: [],
            createdAt: Date(timeIntervalSince1970: TimeInterval(sequence)),
            sequence: sequence
        )
    }
}
