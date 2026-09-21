import XCTest
@testable import Chief

final class MessageHistoryLoaderTests: XCTestCase {
  func testFollowsAllPagesIncludingMoreThanTwoHundredMessages() async throws {
    let sample = DemoWorkspace.messages[0]
    var cursors: [Int?] = []
    let messages = try await MessageHistoryLoader.load(after: nil) { cursor in
      cursors.append(cursor)
      switch cursor {
      case nil: return MessagePage(messages: Array(repeating: sample, count: 200), nextSequence: 200)
      case 200: return MessagePage(messages: Array(repeating: sample, count: 200), nextSequence: 400)
      default: return MessagePage(messages: [sample], nextSequence: nil)
      }
    }
    XCTAssertEqual(cursors, [nil, 200, 400])
    XCTAssertEqual(messages.count, 401)
  }

  func testIncrementalReadKeepsFollowingServerCursor() async throws {
    var cursors: [Int?] = []
    _ = try await MessageHistoryLoader.load(after: 200) { cursor in
      cursors.append(cursor)
      return MessagePage(messages: [DemoWorkspace.messages[0]], nextSequence: cursor == 200 ? 401 : nil)
    }
    XCTAssertEqual(cursors, [200, 401])
  }

  func testRejectsNonAdvancingCursorInsteadOfLoopingForever() async {
    do {
      _ = try await MessageHistoryLoader.load(after: 200) { _ in
        MessagePage(messages: [DemoWorkspace.messages[0]], nextSequence: 200)
      }
      XCTFail("Expected an invalid page to fail")
    } catch {
      XCTAssertEqual(error as? RelayError, .unavailable)
    }
  }
}
