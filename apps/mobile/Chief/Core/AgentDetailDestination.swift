import Foundation

extension AgentSummary {
  func detailAgent(for specialistID: String?) -> AgentSummary {
    guard let specialistID, specialistID.caseInsensitiveCompare(id) != .orderedSame else {
      return self
    }
    let profile =
      self.profile(id: specialistID)
      ?? WorkspaceAgentCatalog.agent(forID: specialistID).map {
        AgentProfile(id: $0.id, name: $0.name, role: $0.role)
      }
      ?? AgentProfile(id: specialistID, name: specialistID.capitalized, role: "Specialist")
    return AgentSummary(
      id: profile.id, name: profile.name, role: profile.role, status: .idle,
      description: profile.description, instructions: profile.instructions,
      capabilities: profile.capabilities)
  }
}
