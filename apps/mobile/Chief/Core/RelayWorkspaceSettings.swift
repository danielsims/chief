import Foundation

/// The parts of a team schedule (`workspaceScheduleSchema`) that settings show.
struct WorkspaceScheduleSummary: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let title: String
  let status: String
}

/// A signed inbound webhook that starts a schedule run (`scheduleWebhookSchema`).
struct ScheduleWebhook: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let scheduleId: String
  let enabled: Bool
  let url: String
  let lastDeliveryAt: Double?

  var lastDeliveryDate: Date? { lastDeliveryAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
}

/// A webhook plus its signing secret, which the relay returns only once.
struct ScheduleWebhookReveal: Decodable, Equatable, Identifiable, Sendable {
  let webhook: ScheduleWebhook
  var secret: String? = nil
  var id: String { webhook.id }
}

/// A computer agents can work on (`machineSchema`).
struct WorkspaceMachine: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let kind: String
  let status: String
  let endpoint: String?
  let capabilities: [String]
  let agentIds: [String]
  let lastSeenAt: String?
}

/// A bounded mission an agent is pursuing (`missionSchema`).
struct WorkspaceMission: Decodable, Equatable, Identifiable, Sendable {
  struct Experiment: Decodable, Equatable, Sendable {}

  let id: String
  let conversationId: String
  let title: String
  let objective: String
  let ownerAgentId: String
  let status: String
  let deadline: String
  let maxExperiments: Int
  let experiments: [Experiment]
}

extension RelayServing {
  func deleteWorkspaceSecret(workspaceID: String, name: String) async throws {
    throw RelayError.unavailable
  }
  func workspaceSchedules(workspaceID: String) async throws -> [WorkspaceScheduleSummary] {
    throw RelayError.unavailable
  }
  func scheduleWebhooks(workspaceID: String) async throws -> [ScheduleWebhook] {
    throw RelayError.unavailable
  }
  func createScheduleWebhook(workspaceID: String, name: String, scheduleID: String) async throws
    -> ScheduleWebhookReveal
  { throw RelayError.unavailable }
  func scheduleWebhookAction(workspaceID: String, webhookID: String, action: String) async throws
    -> ScheduleWebhookReveal
  { throw RelayError.unavailable }
  func workspaceMachines(workspaceID: String) async throws -> [WorkspaceMachine] {
    throw RelayError.unavailable
  }
  func workspaceMissions(workspaceID: String) async throws -> [WorkspaceMission] {
    throw RelayError.unavailable
  }
}

extension URLSessionRelayClient {
  func deleteWorkspaceSecret(workspaceID: String, name: String) async throws {
    var components = URLComponents()
    components.path = "/v1/workspaces/\(workspaceID)/secrets"
    components.queryItems = [URLQueryItem(name: "name", value: name)]
    let _: JSONValue = try await request(path: components.string ?? "", method: "DELETE")
  }

  func workspaceSchedules(workspaceID: String) async throws -> [WorkspaceScheduleSummary] {
    struct Result: Decodable { let schedules: [WorkspaceScheduleSummary] }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/schedules", method: "GET")
    return result.schedules
  }

  func scheduleWebhooks(workspaceID: String) async throws -> [ScheduleWebhook] {
    struct Result: Decodable { let webhooks: [ScheduleWebhook] }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/webhooks", method: "GET")
    return result.webhooks
  }

  func createScheduleWebhook(workspaceID: String, name: String, scheduleID: String) async throws
    -> ScheduleWebhookReveal
  {
    try await request(
      path: "/v1/workspaces/\(workspaceID)/webhooks",
      method: "POST",
      body: JSONEncoder().encode(["name": name, "scheduleId": scheduleID])
    )
  }

  func scheduleWebhookAction(workspaceID: String, webhookID: String, action: String) async throws
    -> ScheduleWebhookReveal
  {
    let id = webhookID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? webhookID
    return try await request(
      path: "/v1/workspaces/\(workspaceID)/webhooks/\(id)/actions",
      method: "POST",
      body: JSONEncoder().encode(["action": action])
    )
  }

  func workspaceMachines(workspaceID: String) async throws -> [WorkspaceMachine] {
    struct Result: Decodable { let machines: [WorkspaceMachine] }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/machines", method: "GET")
    return result.machines
  }

  func workspaceMissions(workspaceID: String) async throws -> [WorkspaceMission] {
    struct Result: Decodable { let missions: [WorkspaceMission] }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/missions", method: "GET")
    return result.missions
  }
}
