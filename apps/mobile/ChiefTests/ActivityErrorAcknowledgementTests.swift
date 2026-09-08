import XCTest
@testable import Chief

final class ActivityErrorAcknowledgementTests: XCTestCase {
  func testReadErrorsStayAcknowledgedAcrossLaunchesWithoutHidingNewFailures() throws {
    let suite = "chief-activity-test-\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    var state = ActivityErrorAcknowledgements(defaults: defaults)
    let readAt = Date(timeIntervalSince1970: 100)
    state.acknowledge(userID: "user", workspaceID: "workspace", conversationID: "dm", at: readAt)
    let restored = ActivityErrorAcknowledgements(defaults: defaults)
    XCTAssertTrue(restored.contains(readAt, userID: "user", workspaceID: "workspace", conversationID: "dm"))
    XCTAssertFalse(restored.contains(readAt.addingTimeInterval(1), userID: "user", workspaceID: "workspace", conversationID: "dm"))
    XCTAssertFalse(restored.contains(readAt, userID: "another-user", workspaceID: "workspace", conversationID: "dm"))
    XCTAssertFalse(restored.contains(readAt, userID: "user", workspaceID: "another-workspace", conversationID: "dm"))
    XCTAssertFalse(restored.contains(readAt, userID: "user", workspaceID: "workspace", conversationID: "another-dm"))
  }
}
