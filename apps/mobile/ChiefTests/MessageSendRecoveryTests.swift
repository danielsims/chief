import XCTest

@testable import Chief

final class MessageSendRecoveryTests: XCTestCase {
  func testRestoresFailedMessageIntoAnEmptyComposer() {
    XCTAssertEqual(
      MessageSendRecovery.restoredDraft(pending: "Original", current: ""),
      "Original"
    )
  }

  func testDoesNotOverwriteTextEnteredWhileSendWasInFlight() {
    XCTAssertEqual(
      MessageSendRecovery.restoredDraft(pending: "Original", current: "New draft"),
      "Original\nNew draft"
    )
  }
}
