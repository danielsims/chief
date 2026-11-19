import Foundation

/// Where to watch an agent's browser on a paired computer, with the one-time
/// ticket the computer checks (`machineViewerTicketSchema`).
struct MachineViewerTicket: Decodable, Sendable {
  let url: URL
  let protocols: [String]
}

extension RelayServing {
  func machineViewerTicket(
    workspaceID: String,
    agentID: String,
    sessionID: String
  ) async throws -> MachineViewerTicket {
    throw RelayError.unavailable
  }

  func stopMachineBrowser(workspaceID: String, agentID: String, sessionID: String) async throws {
    throw RelayError.unavailable
  }
}

extension URLSessionRelayClient {
  /// Each connection takes a fresh ticket; one is good for a single viewer
  /// and a minute.
  func machineViewerTicket(
    workspaceID: String,
    agentID: String,
    sessionID: String
  ) async throws -> MachineViewerTicket {
    struct Input: Encodable {
      let agentId: String
      let sessionId: String
    }
    return try await request(
      path: "/v1/workspaces/\(workspaceID)/machines/viewer-tickets",
      method: "POST",
      body: try JSONEncoder().encode(Input(agentId: agentID, sessionId: sessionID))
    )
  }

  /// Ends the agent's browser session on its computer. Only the agent's
  /// owner may; the relay refuses anyone else.
  func stopMachineBrowser(workspaceID: String, agentID: String, sessionID: String) async throws {
    struct Input: Encodable {
      let agentId: String
      let sessionId: String
    }
    struct Stopped: Decodable { let stopped: Bool }
    let _: Stopped = try await request(
      path: "/v1/workspaces/\(workspaceID)/machines/browser-stops",
      method: "POST",
      body: try JSONEncoder().encode(Input(agentId: agentID, sessionId: sessionID))
    )
  }
}
