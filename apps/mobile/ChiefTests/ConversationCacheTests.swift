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

    func testUpdateInsertsCursorCatchUpWhenAppendPrecedesFrontier() {
        let cache = ConversationCache()
        let completed = message(id: "activity", workspace: "workspace-a", sequence: 3)

        cache.update(completed)

        XCTAssertEqual(
            cache.messages(workspaceID: "workspace-a", conversationID: "general"),
            [completed]
        )
    }

    func testHistoryPreservesConcurrentLiveArrivalsAndEdits() {
        let cache = ConversationCache()
        let old = message(id: "old", workspace: "workspace-a", sequence: 1)
        cache.merge(old)
        let baseline = cache.messages(workspaceID: "workspace-a", conversationID: "general")
        var edited = old
        edited.body = "Live edit"
        cache.update(edited)
        let live = message(id: "live", workspace: "workspace-a", sequence: 3)
        cache.merge(live)
        let missed = message(id: "missed", workspace: "workspace-a", sequence: 2)
        cache.reconcileHistory(workspaceID: "workspace-a", conversationID: "general", messages: [old, missed], baseline: baseline)
        XCTAssertEqual(cache.messages(workspaceID: "workspace-a", conversationID: "general"), [edited, missed, live])
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
