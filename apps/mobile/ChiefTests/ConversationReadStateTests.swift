import Foundation
import Testing

@testable import Chief

struct ConversationReadStateTests {
  @Test func channelCursorClearsTopLevelAndThreadMessages() {
    let readAt = Date(timeIntervalSince1970: 100)
    var state = ConversationReadState()
    let advanced = state.advance(
      ConversationReadState.channelKey("mission-control"),
      to: readAt
    )
    #expect(advanced)

    #expect(!state.isUnread(
      createdAt: readAt,
      conversationID: "mission-control",
      threadRootID: nil
    ))
    #expect(!state.isUnread(
      createdAt: readAt,
      conversationID: "mission-control",
      threadRootID: "root-1"
    ))
    #expect(state.isUnread(
      createdAt: readAt.addingTimeInterval(1),
      conversationID: "mission-control",
      threadRootID: "root-1"
    ))
  }

  @Test func threadCursorDoesNotClearTheRestOfTheChannel() {
    let readAt = Date(timeIntervalSince1970: 100)
    var state = ConversationReadState()
    let advanced = state.advance(
      ConversationReadState.threadKey("mission-control", rootMessageID: "root-1"),
      to: readAt
    )
    #expect(advanced)

    #expect(!state.isUnread(
      createdAt: readAt,
      conversationID: "mission-control",
      threadRootID: "root-1"
    ))
    #expect(state.isUnread(
      createdAt: readAt,
      conversationID: "mission-control",
      threadRootID: "root-2"
    ))
    #expect(state.isUnread(
      createdAt: readAt,
      conversationID: "mission-control",
      threadRootID: nil
    ))
  }

  @Test func persistedCursorsAreIsolatedByWorkspaceAndReader() throws {
    let suite = "ConversationReadStateTests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = ConversationReadStateStore(defaults: defaults)
    var state = ConversationReadState()
    let readAt = Date(timeIntervalSince1970: 100)
    _ = state.advance(ConversationReadState.channelKey("general"), to: readAt)

    store.save(state, workspaceID: "workspace-a", readerID: "reader-a")

    #expect(store.load(workspaceID: "workspace-a", readerID: "reader-a") == state)
    #expect(store.load(workspaceID: "workspace-b", readerID: "reader-a").contexts.isEmpty)
    #expect(store.load(workspaceID: "workspace-a", readerID: "reader-b").contexts.isEmpty)
  }
}
