import XCTest

@testable import Chief

final class ScheduledRunTests: XCTestCase {
  func testAnnouncementPreservesTeamAcrossDecodeAndCacheRoundTrip() throws {
    let json =
      #"{"id":"run-card","kind":"schedule.run","payload":{"runId":"run-1","scheduleId":"schedule-1","title":"Create a launch asset","agentIds":["chief","brand","content"]}}"#
    let component = try JSONDecoder().decode(MessageComponent.self, from: Data(json.utf8))
    let restored = try JSONDecoder().decode(
      MessageComponent.self, from: JSONEncoder().encode(component))
    XCTAssertEqual(restored.payloadArrays["agentIds"], ["chief", "brand", "content"])
    let reference = try XCTUnwrap(ScheduledRunReference(message: message(component: restored)))
    XCTAssertEqual(reference.title, "Create a launch asset")
    XCTAssertEqual(reference.agentIDs, ["chief", "brand", "content"])
    XCTAssertNil(
      ScheduledRunReference(
        message: message(component: restored, author: .user(id: "person", name: "Person"))))
  }

  func testSpecialistNamesDoNotFallBackToChief() {
    XCTAssertEqual(DemoWorkspace.snapshot.agentDisplayName("brand"), "Marketer")
    XCTAssertEqual(DemoWorkspace.snapshot.agentDisplayName("content"), "Content")
    XCTAssertNil(DemoWorkspace.snapshot.agentDisplayName("unknown-agent"))
  }

  func testRunPresenceUsesActualAssignmentsAndThreadScope() throws {
    let run = try decodeRun(state: "running")
    XCTAssertEqual(run.agentIDs, ["chief", "brand", "content"])
    XCTAssertEqual(run.workingAgentIDs, ["brand"])
    XCTAssertEqual(
      WorkspaceScheduleRun.workingPresences([run, run], threadRootID: "thread-1", name: { $0 }).map(
        \.id), ["brand"])
    XCTAssertTrue(
      WorkspaceScheduleRun.workingPresences([run], threadRootID: "other", name: { $0 }).isEmpty)
    for state in ["queued", "completed", "failed", "blocked", "cancelled"] {
      XCTAssertTrue(try decodeRun(state: state).workingAgentIDs.isEmpty)
    }
  }

  func testOnlyASuccessfulPostToThisRunSuppressesDuplicateCompletion() {
    let receipt = #"{"messageId":"message","conversationId":"marketing","threadRootId":"thread-1"}"#
    let posted = MessageComponent(
      id: "tool", kind: "tool",
      payload: ["name": RelayMessagePostTool.name, "status": "completed", "output": receipt])
    XCTAssertTrue(
      ScheduledRunDelivery.alreadyPublished(
        components: [posted], conversationID: "marketing", threadRootID: "thread-1"))
    XCTAssertFalse(
      ScheduledRunDelivery.alreadyPublished(
        components: [posted], conversationID: "marketing", threadRootID: "other"))
    let failed = MessageComponent(
      id: "failed", kind: "tool",
      payload: ["name": RelayMessagePostTool.name, "status": "failed", "output": receipt])
    XCTAssertFalse(
      ScheduledRunDelivery.alreadyPublished(
        components: [failed], conversationID: "marketing", threadRootID: "thread-1"))
    XCTAssertFalse(
      ScheduledRunDelivery.alreadyPublished(
        components: [], conversationID: "marketing", threadRootID: "thread-1"))
  }

  func testScheduleAndArtifactMutationsRespectAskFirst() {
    let names = Set([
      WorkspaceScheduleProposeTool.name, ScheduleRunCollaboratorTool.name,
      ScheduleRunReportTool.name, WorkspaceFileWriteTool.name,
    ])
    var config = AgentConfig.defaults(for: "chief")
    XCTAssertEqual(
      AgentToolAuthorization.grant(requestedToolNames: names, config: config).toolNames, names)
    config.approvals = "ask"
    XCTAssertTrue(
      AgentToolAuthorization.grant(requestedToolNames: names, config: config).toolNames.isEmpty)
  }

  private func decodeRun(state: String) throws -> WorkspaceScheduleRun {
    let json = """
      {"id":"run-1","scheduleId":"schedule-1","threadRootId":"thread-1","state":"\(state)","schedule":{"agentId":"chief","collaborators":["brand","content"],"conversationId":"marketing"},"steps":[{"id":"plan","agentId":"chief","phase":"plan","state":"completed"},{"id":"write","agentId":"brand","phase":"contribute","state":"running"},{"id":"extra","agentId":"content","phase":"contribute","state":"pending"}]}
      """
    return try JSONDecoder().decode(WorkspaceScheduleRun.self, from: Data(json.utf8))
  }
  private func message(component: MessageComponent, author: ConversationMessage.Author = .system)
    -> ConversationMessage
  {
    ConversationMessage(
      id: "thread-1", workspaceID: "workspace", conversationID: "marketing", threadRootID: nil,
      author: author, body: "Scheduled run", components: [component], createdAt: .now, sequence: 1)
  }
}
