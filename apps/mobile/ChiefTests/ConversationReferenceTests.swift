import XCTest
@testable import Chief

final class ConversationReferenceTests: XCTestCase {
  private let snapshot = WorkspaceSnapshot(id: "workspace", name: "Test", onboardingComplete: true,
    conversations: [
      .init(id: "channel-123", name: "marketing", kind: .channel, isPrivate: false, unreadCount: 0, requiresAttention: false, lastMessage: nil),
      .init(id: "direct-123", name: "Chief", kind: .direct, isPrivate: true, unreadCount: 0, requiresAttention: false, lastMessage: nil),
    ], agents: [], projects: [])

  func testResolvesChannelNamesAndPreservesIDs() {
    XCTAssertEqual(snapshot.conversationID(for: "#Marketing"), "channel-123")
    XCTAssertEqual(snapshot.conversationID(for: "marketing"), "channel-123")
    XCTAssertEqual(snapshot.conversationID(for: "channel-123"), "channel-123")
    XCTAssertEqual(snapshot.conversationID(for: "direct-123"), "direct-123")
    XCTAssertNil(snapshot.conversationID(for: "Chief"))
    XCTAssertNil(snapshot.conversationID(for: "missing"))
  }

  func testEveryPermissionAppearsInExactlyOneGroup() {
    let permissions = AgentPermissionGroup.all.flatMap(\.permissions)
    XCTAssertEqual(permissions.sorted(), AgentConfig.allToolPermissions.sorted())
    XCTAssertEqual(Set(permissions).count, permissions.count)
  }
}
