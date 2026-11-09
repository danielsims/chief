import Foundation

enum AgentPresence {
  case working, error, online, offline
}

extension AppModel {
  /// Whether a person has Chief open.
  func isUserOnline(_ userID: String?) -> Bool {
    guard let userID, let presence, presence.workspaceID == workspace?.id else { return false }
    return presence.userIDs.contains(userID)
  }

  /// A subagent runs in its parent's cell, so it shares the parent's presence.
  func agentPresence(_ agentID: String?, working: Bool = false) -> AgentPresence {
    if working { return .working }
    guard let agentID else { return .online }
    let host =
      workspace?.agents.first(where: { $0.subagents.contains { $0.id == agentID } })?.id
      ?? agentID
    guard let presence, presence.workspaceID == workspace?.id else { return .online }
    if presence.erroredAgentIDs.contains(agentID) { return .error }
    return presence.offlineAgentIDs.contains(host) ? .offline : .online
  }
}
