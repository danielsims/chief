import XCTest

@testable import Chief

final class AgentRosterTests: XCTestCase {
  func testDecodesRootAgentsWithoutSubagentsFromOlderSnapshots() throws {
    let data = Data(
      #"""
      {"id":"chief","name":"Chief","role":"Workspace Lead","status":"idle"}
      """#.utf8
    )

    let agent = try JSONDecoder().decode(AgentSummary.self, from: data)

    XCTAssertEqual(agent.id, "chief")
    XCTAssertEqual(agent.subagents, [])
    XCTAssertEqual(agent.description, "")
  }

  func testResolvesSpecialistsToTheParentAgentCard() throws {
    let chief = AgentSummary(
      id: "chief",
      name: "Chief",
      role: "Workspace Lead",
      status: .idle,
      description: "Leads the workspace.",
      subagents: [
        AgentProfile(id: "brand", name: "Marketer", role: "Marketing"),
        AgentProfile(id: "engineer", name: "Engineer", role: "Product Engineering"),
      ]
    )
    let snapshot = WorkspaceSnapshot(
      id: "workspace",
      name: "Chief",
      onboardingComplete: true,
      conversations: [],
      agents: [chief],
      projects: []
    )

    let marketer = try XCTUnwrap(snapshot.agentCard(for: "brand"))
    XCTAssertEqual(marketer.agent.id, "chief")
    XCTAssertEqual(marketer.subagentID, "brand")

    let weather = try XCTUnwrap(snapshot.agentCard(for: "weather"))
    XCTAssertEqual(weather.agent.id, "chief")
    XCTAssertEqual(weather.subagentID, "weather")

    let root = try XCTUnwrap(snapshot.agentCard(for: "chief"))
    XCTAssertEqual(root.agent.id, "chief")
    XCTAssertNil(root.subagentID)
  }
}
