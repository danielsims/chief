import XCTest

@testable import Chief

final class AgentTurnCheckpointTests: XCTestCase {
  func testCheckpointFailsClosedWhenWorkflowWorldRejectsWrite() async {
    let checkpoint = AgentTurnCheckpoint(
      scope: "workspace:chief",
      conversationID: "mission-control",
      userAt: 42,
      world: RejectingWorkflowWorld()
    )

    do {
      try await checkpoint.begin()
      XCTFail("A turn must not start without durable checkpoint storage.")
    } catch ChiefCellError.storageUnavailable {
      // Expected: inference cannot begin if its recoverable turn cannot persist.
    } catch {
      XCTFail("Unexpected error: \(error)")
    }
  }

  func testExtractorScopesDurableActivityToLatestTurn() throws {
    let result = workerResult(
      messages: [
        message(role: "user", content: "first", at: 1),
        activity(role: "tool", id: "old-tool", name: "old", at: 2),
        message(role: "assistant", content: "first reply", at: 3),
        message(role: "user", content: "second", at: 4),
        activity(role: "tool", id: "new-tool", name: "new", at: 5),
        message(role: "assistant", content: "second reply", at: 6),
      ],
      state: ["sessionId": "session-fixed", "streamIndex": 6]
    )

    let turn = try TurnExtractor.extract(from: result)

    XCTAssertEqual(turn.reply, "second reply")
    XCTAssertEqual(turn.components.map(\.id), ["new-tool"])
    XCTAssertEqual(turn.sessionID, "session-fixed")
    XCTAssertEqual(turn.streamIndex, 6)
  }

  func testExtractorRetainsCheckpointReasoningIdentity() throws {
    let result = workerResult(
      messages: [
        message(role: "user", content: "continue", at: 1),
        [
          "role": "reasoning",
          "activityId": "reasoning-checkpoint",
          "content": #"{"text":"Checking the source","status":"completed"}"#,
          "at": 2,
        ],
        message(role: "assistant", content: "Done", at: 3),
      ],
      state: [:]
    )

    let turn = try TurnExtractor.extract(from: result)

    XCTAssertEqual(turn.components.first?.id, "reasoning-checkpoint")
    XCTAssertEqual(turn.components.first?.kind, "thinking")
    XCTAssertEqual(turn.components.first?.payload["status"], "completed")
  }

  private func workerResult(
    messages: [[String: Any]],
    state: [String: Any]
  ) -> String {
    let body = try! JSONSerialization.data(
      withJSONObject: ["messages": messages, "state": state]
    )
    return String(decoding: body, as: UTF8.self)
  }

  private func message(role: String, content: String, at: Int) -> [String: Any] {
    ["role": role, "content": content, "at": at]
  }

  private func activity(
    role: String,
    id: String,
    name: String,
    at: Int
  ) -> [String: Any] {
    [
      "role": role,
      "activityId": id,
      "content": #"{"id":"\#(id)","name":"\#(name)","status":"completed"}"#,
      "at": at,
    ]
  }
}

private struct RejectingWorkflowWorld: AgentWorkflowWorld {
  func put(
    scope: String,
    conversationID: String,
    key: String,
    json: String
  ) -> Bool {
    false
  }
}
