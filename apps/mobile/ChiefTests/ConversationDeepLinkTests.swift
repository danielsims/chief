import XCTest

@testable import Chief

final class ConversationDeepLinkTests: XCTestCase {
  func testParsesNotificationUserInfoIncludingThread() {
    let link = ConversationDeepLink(
      userInfo: [
        "workspaceID": "workspace-a",
        "conversationID": "marketing",
        "threadRootID": "root-1",
      ]
    )

    XCTAssertEqual(link?.workspaceID, "workspace-a")
    XCTAssertEqual(link?.conversationID, "marketing")
    XCTAssertEqual(link?.threadRootID, "root-1")
  }

  func testParsesMobileConversationURL() throws {
    let url = URL(
      string: "chief-mobile://conversation?workspace=workspace-a&channel=marketing&thread=root-1"
    )!
    let link = try XCTUnwrap(ConversationDeepLink(url: url))
    XCTAssertEqual(link.workspaceID, "workspace-a")
    XCTAssertEqual(link.conversationID, "marketing")
    XCTAssertEqual(link.threadRootID, "root-1")
  }

  func testParsesDeepLinkURLCarriedInThePushPayload() throws {
    let link = try XCTUnwrap(
      ConversationDeepLink(
        userInfo: [
          "url": "chief-mobile://conversation?workspace=workspace-a&channel=daniel"
        ]
      )
    )
    XCTAssertEqual(link.conversationID, "daniel")
    XCTAssertNil(link.threadRootID)
  }

  func testRoundTripsThroughItsOwnURL() throws {
    let original = ConversationDeepLink(
      workspaceID: "workspace-a",
      conversationID: "engineering",
      threadRootID: "root-9"
    )
    let parsed = try XCTUnwrap(ConversationDeepLink(url: original.url))
    XCTAssertEqual(parsed, original)
  }

  func testIgnoresUnrelatedChiefURLs() {
    XCTAssertNil(ConversationDeepLink(url: URL(string: "chief-mobile://auth")!))
    XCTAssertNil(ConversationDeepLink(userInfo: ["aps": ["alert": "Hello"]]))
  }
}
