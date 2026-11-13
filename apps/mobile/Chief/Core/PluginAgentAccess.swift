import Foundation

struct PluginAgentAccess: Decodable, Sendable {
  struct Agent: Decodable, Sendable {
    let id: String
    let name: String
    var parentId: String?
    let deploymentTarget: String
    let canEdit: Bool
    var reason: String?
  }
  let agents: [Agent]
  let assignedAgentIds: [String]
}

extension RelayServing {
  func pluginAgentAccess(workspaceID: String, connectionID: String) async throws -> PluginAgentAccess {
    throw RelayError.unavailable
  }
  func setPluginAgentAccess(workspaceID: String, connectionID: String, agentIDs: [String], enabled: Bool) async throws -> PluginAgentAccess {
    throw RelayError.unavailable
  }
}

extension URLSessionRelayClient {
  func pluginAgentAccess(workspaceID: String, connectionID: String) async throws -> PluginAgentAccess {
    let id = connectionID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? connectionID
    return try await request(path: "/v1/workspaces/\(workspaceID)/plugins/\(id)/access", method: "GET")
  }
  func setPluginAgentAccess(workspaceID: String, connectionID: String, agentIDs: [String], enabled: Bool) async throws -> PluginAgentAccess {
    struct Body: Encodable { let agentIds: [String]; let enabled: Bool }
    let id = connectionID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? connectionID
    return try await request(path: "/v1/workspaces/\(workspaceID)/plugins/\(id)/access", method: "POST", body: try JSONEncoder().encode(Body(agentIds: agentIDs, enabled: enabled)))
  }
}
