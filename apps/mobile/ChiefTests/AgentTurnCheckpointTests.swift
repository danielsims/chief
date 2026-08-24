import XCTest

@testable import Chief

final class AgentTurnCheckpointTests: XCTestCase {
  func testSpecialistSkillReferencesDoNotWidenChiefTurn() {
    let delegation =
      "Ask @Marketer to use [chief-skill:build-brand-profile] and @Prospector to use [chief-skill:find-buying-signals]."

    XCTAssertNil(
      AgentSkillBundle.resolvedSkillID(referencedBy: delegation, agentID: "chief")
    )
    XCTAssertEqual(
      AgentSkillBundle.resolvedSkillID(referencedBy: delegation, agentID: "brand"),
      "build-brand-profile"
    )
    XCTAssertEqual(
      AgentSkillBundle.resolvedSkillID(referencedBy: delegation, agentID: "prospector"),
      "find-buying-signals"
    )
  }

  func testSpecialistKickoffAddsItsOwnedSkillTools() {
    let names = AgentTurnToolPolicy.names(
      requiresChiefDelegation: false,
      requiresSpecialistKickoff: true,
      attachedSkillIDs: ["build-brand-profile"]
    )

    XCTAssertTrue(names.contains(RelayChannelCreateTool.name))
    XCTAssertTrue(names.contains(RelayChannelMembersAddTool.name))
    XCTAssertTrue(names.contains(BrowserNavigateTool.name))
    XCTAssertTrue(names.contains(BrandProfileSaveTool.name))
    XCTAssertFalse(names.contains(ProspectSaveTool.name))
  }

  func testTurnGrantIntersectsTaskAndExactAgentPermission() {
    var config = AgentConfig.defaults(for: "brand")
    config.toolPermissions = [AgentToolPermissionID.channelsRead.rawValue]
    let grant = AgentToolAuthorization.grant(
      requestedToolNames: [
        RelayChannelsListTool.name,
        RelayChannelCreateTool.name,
        BrowserNavigateTool.name,
      ],
      config: config
    )

    XCTAssertEqual(grant.toolNames, [RelayChannelsListTool.name])
    XCTAssertFalse(grant.permits(toolName: "unmapped_tool"))
  }

  func testAskApprovalFailsClosedForMutations() {
    var config = AgentConfig.defaults(for: "chief")
    config.approvals = "ask"
    let grant = AgentToolAuthorization.grant(
      requestedToolNames: [
        RelayChannelsListTool.name,
        RelayMessagePostTool.name,
      ],
      config: config
    )

    XCTAssertTrue(grant.permits(toolName: RelayChannelsListTool.name))
    XCTAssertFalse(grant.permits(toolName: RelayMessagePostTool.name))
  }

  func testLegacyConfigNormalizesToExactExecutorPermissions() {
    var config = AgentConfig()
    config.toolPermissions = ["channels", "messages", "advanced"]

    let normalized = config.normalized.toolPermissions

    XCTAssertTrue(normalized.contains(AgentToolPermissionID.channelsCreate.rawValue))
    XCTAssertTrue(normalized.contains(AgentToolPermissionID.messagesSend.rawValue))
    XCTAssertTrue(normalized.contains(AgentToolPermissionID.browserUse.rawValue))
    XCTAssertFalse(normalized.contains("channels"))
  }

  func testEveryVisibleBrowserActionRequiresAnOperatingLabel() {
    let tools: [any RelayTool.Type] = [
      BrowserNavigateTool.self,
      BrowserSnapshotTool.self,
      BrowserClickTool.self,
      BrowserTypeTool.self,
      BrowserScrollTool.self,
      BrowserBackTool.self,
    ]

    for tool in tools {
      let label = tool.parameters.first { $0.name == "activityLabel" }
      XCTAssertNotNil(label, "\(tool.name) must surface its current purpose")
      XCTAssertEqual(label?.kind, .string)
      XCTAssertEqual(label?.required, true)
    }
  }

  @MainActor
  func testBrowserPresentationReparentsOneScopedDriver() {
    let scope = "browser-presentation-test:\(UUID().uuidString)"
    let driver = AgentBrowserSession.engage(
      for: scope,
      operationLabel: "  Reviewing   the latest integration documentation in detail  "
    )

    XCTAssertTrue(driver === AgentBrowserSession.existingDriver(for: scope))
    XCTAssertEqual(driver.scope, scope)
    XCTAssertEqual(driver.displayMode, .pictureInPicture)
    XCTAssertLessThanOrEqual(AgentBrowserSession.operationLabel(for: scope)?.count ?? 0, 48)
    XCTAssertTrue(
      AgentBrowserSession.shouldPresent(driver, for: scope, placement: .pictureInPicture)
    )

    let lifecycleID = driver.lifecycleSessionId
    driver.phase = .connecting
    _ = AgentBrowserSession.engage(for: scope, operationLabel: "Loading pricing")
    XCTAssertEqual(driver.lifecycleSessionId, lifecycleID)
    XCTAssertTrue(
      AgentBrowserSession.shouldPresent(driver, for: scope, placement: .pictureInPicture)
    )

    AgentBrowserSession.setDisplayMode(.inline, for: scope)

    XCTAssertTrue(driver === AgentBrowserSession.existingDriver(for: scope))
    XCTAssertEqual(driver.displayMode, .inline)
    driver.end()
  }

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

  func testExtractorPreservesCellFailureDetailForActivity() throws {
    let data = try JSONSerialization.data(
      withJSONObject: [
        "messages": [message(role: "user", content: "continue", at: 1)],
        "error": "The development inference connection closed before the turn completed.",
        "errorCode": "run_failed",
      ]
    )

    XCTAssertThrowsError(try TurnExtractor.extract(from: String(decoding: data, as: UTF8.self))) {
      error in
      guard let cellError = error as? AgentCellTurnError else {
        return XCTFail("Expected AgentCellTurnError, got \(error)")
      }
      XCTAssertEqual(cellError.code, "run_failed")
      XCTAssertEqual(
        AgentRunFailure(cellError).message,
        "The development inference connection closed before the turn completed."
      )
    }
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
