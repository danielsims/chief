import XCTest

@testable import Chief

final class KickoffToolEvidenceTests: XCTestCase {
  func testKickoffRequiresSuccessfulChannelAndMembershipTools() throws {
    let root = "kickoff-root"
    let components = [
      tool(
        RelayMessagePostTool.name,
        input: [
          "conversationId": "mission-control",
          "threadRootId": root,
          "body": "I'm starting now.",
        ]
      ),
      tool(
        RelayChannelCreateTool.name,
        input: [
          "conversationId": "marketing",
          "name": "marketing",
          "isPrivate": false,
        ]
      ),
      tool(RelayWorkspaceMembersTool.name, input: [:]),
      tool(
        RelayChannelMembersAddTool.name,
        input: [
          "conversationId": "marketing",
          "kind": "user",
          "principalId": "workspace-owner",
        ]
      ),
    ]

    XCTAssertNoThrow(
      try KickoffToolEvidence.validate(
        components: components,
        jobKind: "workspace.kickoff.marketing",
        expectedThreadRootID: root
      )
    )
  }

  func testKickoffRequiresEverySpecialistToolBeforeRelayVerification() {
    XCTAssertThrowsError(
      try KickoffToolEvidence.validate(
        components: [
          tool(
            RelayChannelCreateTool.name,
            input: ["conversationId": "marketing"]
          ),
          tool(RelayWorkspaceMembersTool.name, input: [:]),
          tool(
            RelayChannelMembersAddTool.name,
            input: [
              "conversationId": "marketing",
              "kind": "user",
              "principalId": "workspace-owner",
            ]
          ),
        ],
        jobKind: "workspace.kickoff.marketing",
        expectedThreadRootID: "kickoff-root"
      )
    )
  }

  func testChiefDelegationRequiresEveryMissionControlInviteAndKickoff() throws {
    var components: [MessageComponent] = []
    components.append(tool(
      RelayMessagePostTool.name,
      input: ["conversationId": "mission-control", "body": "Welcome to Chief"]
    ))
    components.append(tool(
      RelayChannelMembersAddTool.name,
      input: [
        "conversationId": "mission-control",
        "kind": "agent",
        "principalIds": ["brand", "prospector", "engineer"],
      ]
    ))
    for (_, mention) in [
      ("brand", "@Marketer"),
      ("prospector", "@Prospector"),
      ("engineer", "@Engineer"),
    ] {
      components.append(tool(
        RelayMessagePostTool.name,
        input: ["conversationId": "mission-control", "body": "Hey \(mention), start now."]
      ))
    }

    XCTAssertNoThrow(
      try KickoffToolEvidence.validate(
        components: components,
        jobKind: "workspace.onboarding"
      )
    )
  }

  func testChiefDelegationRejectsAReportedKickoffWithoutAllAgents() {
    XCTAssertThrowsError(
      try KickoffToolEvidence.validate(
        components: [
          tool(
            RelayChannelMembersAddTool.name,
            input: [
              "conversationId": "mission-control",
              "kind": "agent",
              "principalId": "brand",
            ]
          ),
          tool(
            RelayMessagePostTool.name,
            input: ["conversationId": "mission-control", "body": "Hey @Marketer"]
          ),
        ],
        jobKind: "workspace.onboarding"
      )
    )
  }

  func testKickoffRejectsPlainTextWithoutToolEvidence() {
    XCTAssertThrowsError(
      try KickoffToolEvidence.validate(
        components: [],
        jobKind: "workspace.kickoff.marketing"
      )
    ) { error in
      XCTAssertEqual(
        error as? WorkspaceSetupError,
        .missingRequiredToolCalls
      )
    }
  }

  func testOrdinaryAgentTurnsDoNotRequireKickoffTools() {
    XCTAssertNoThrow(
      try KickoffToolEvidence.validate(
        components: [],
        jobKind: "conversation.turn"
      )
    )
  }

  func testFailedResumedTurnDoesNotReuseAStaleAssistantReply() throws {
    let body = try JSONSerialization.data(
      withJSONObject: [
        "messages": [
          ["role": "assistant", "content": "A reply from an older attempt"]
        ],
        "error": "rate limited",
        "errorCode": "provider_usage_limit",
      ]
    )
    let workerResult = try JSONSerialization.data(
      withJSONObject: [
        "status": 502,
        "body": String(decoding: body, as: UTF8.self),
      ]
    )

    XCTAssertThrowsError(
      try TurnExtractor.extract(from: String(decoding: workerResult, as: UTF8.self))
    ) { error in
      XCTAssertEqual(error as? WorkspaceSetupError, .providerUsageLimit)
    }
  }

  func testAgentRetryPolicyMatchesDesktopProgressiveDelays() throws {
    let now = Date(timeIntervalSince1970: 1_000)
    let expected: [TimeInterval] = [1, 2, 4, 8]

    for (index, delay) in expected.enumerated() {
      let retry = try XCTUnwrap(
        AgentRetryPolicy.retryDate(
          attempt: index + 1,
          error: WorkspaceSetupError.inferenceFailed,
          now: now,
          jitter: 0
        )
      )
      XCTAssertEqual(retry.timeIntervalSince(now), delay)
    }
    XCTAssertNil(
      AgentRetryPolicy.retryDate(
        attempt: 5,
        error: WorkspaceSetupError.inferenceFailed,
        now: now,
        jitter: 0
      )
    )
  }

  func testUsageLimitRequiresUserActionInsteadOfAutomaticRetry() {
    XCTAssertNil(
      AgentRetryPolicy.retryDate(
        attempt: 1,
        error: WorkspaceSetupError.providerUsageLimit,
        jitter: 0
      )
    )
  }

  private func tool(_ name: String, input: [String: Any]) -> MessageComponent {
    let data = try! JSONSerialization.data(withJSONObject: input)
    return MessageComponent(
      id: UUID().uuidString,
      kind: "tool",
      payload: [
        "name": name,
        "status": "completed",
        "input": String(decoding: data, as: UTF8.self),
      ]
    )
  }
}
