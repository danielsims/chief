import Foundation
import os

let relayLog = Logger(subsystem: "sh.heychief.mobile", category: "relay")

protocol RelayServing: Sendable {
  func loadWorkspace() async throws -> WorkspaceSnapshot
  func createWorkspace(from draft: OnboardingDraft) async throws -> WorkspaceSnapshot
  func messages(workspaceID: String, conversationID: String, after sequence: Int?) async throws -> [ConversationMessage]
  func send(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String]
  ) async throws -> ConversationMessage
  func claimAgentJob(workspaceID: String, agentID: String) async throws -> AgentJobLease?
  func completeAgentJob(
    workspaceID: String,
    agentID: String,
    leaseToken: String,
    completion: AgentJobCompletion
  ) async throws
  func recordLogs(workspaceID: String, _ entries: [RelayLogEntry]) async throws
}

struct AgentJobCompletion: Sendable, Equatable {
  var openingMessage: String?
  var publishedMessage: AgentPublishedMessage?
}

struct AgentPublishedMessage: Sendable, Equatable, Codable {
  var conversationId: String
  var body: String
  var components: [MessageComponent] = []
}

struct RelayLogEntry: Sendable, Equatable, Codable {
  var id: String
  var correlationId: String
  var type: String
  var operation: String
  var agentId: String?
  var conversationId: String?
  var message: String
  var createdAt: String

  static func make(
    type: String = "info",
    operation: String,
    agentId: String? = nil,
    message: String
  ) -> RelayLogEntry {
    RelayLogEntry(
      id: UUID().uuidString,
      correlationId: UUID().uuidString,
      type: type,
      operation: operation,
      agentId: agentId,
      conversationId: nil,
      message: message,
      createdAt: ISO8601DateFormatter.chief().string(from: .now)
    )
  }
}

/// Best-effort, never-fatal log sink to the relay's retained workspace log.
struct RelayLogSink {
  private let relay: any RelayServing
  private let workspaceID: String

  init(relay: any RelayServing, workspaceID: String) {
    self.relay = relay
    self.workspaceID = workspaceID
  }

  func record(_ entries: [RelayLogEntry]) {
    Task { try? await relay.recordLogs(workspaceID: workspaceID, entries) }
  }

  func record(_ entry: RelayLogEntry) {
    record([entry])
  }
}

actor URLSessionRelayClient: RelayServing {
  private let configuration: AppConfiguration
  private let session: URLSession
  private let decoder: JSONDecoder

  init(configuration: AppConfiguration, session: URLSession? = nil) {
    self.configuration = configuration
    let configured = session ?? Self.makeSession()
    self.session = configured
    self.decoder = JSONDecoder()
  }

  private static func makeSession() -> URLSession {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 20
    config.timeoutIntervalForResource = 30
    return URLSession(configuration: config)
  }

  func loadWorkspace() async throws -> WorkspaceSnapshot {
    try await request(path: "/v1/me/workspace", method: "GET")
  }

  func createWorkspace(from draft: OnboardingDraft) async throws -> WorkspaceSnapshot {
    let body = try JSONEncoder().encode(CreateWorkspaceInput(draft: draft))
    return try await request(path: "/v1/workspaces", method: "POST", body: body)
  }

  func messages(
    workspaceID: String,
    conversationID: String,
    after sequence: Int?
  ) async throws -> [ConversationMessage] {
    var path =
      "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages?limit=200"
    if let sequence { path += "&after=\(sequence)" }
    let page: MessagePage = try await request(path: path, method: "GET")
    return page.messages
  }

  func send(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String]
  ) async throws -> ConversationMessage {
    let command = AppendMessageInput(
      commandId: UUID().uuidString,
      occurredAt: ISO8601DateFormatter.chief().string(from: .now),
      payload: .init(
        messageId: UUID().uuidString,
        conversationId: conversationID,
        threadRootId: threadRootID,
        body: body,
        mentions: mentions,
        components: []
      )
    )
    let encoded = try JSONEncoder().encode(command)
    let result: AppendMessageResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages",
      method: "POST",
      body: encoded
    )
    return result.message
  }

  func claimAgentJob(workspaceID: String, agentID: String) async throws -> AgentJobLease? {
    let body = try JSONEncoder().encode(
      ClaimAgentJobInput(workerId: "chief-mobile-\(UUID().uuidString)", leaseSeconds: 120)
    )
    do {
      return try await request(
        path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/jobs/claim",
        method: "POST",
        body: body
      )
    } catch RelayError.httpStatus(204) {
      return nil
    }
  }

  func completeAgentJob(
    workspaceID: String,
    agentID: String,
    leaseToken: String,
    completion: AgentJobCompletion
  ) async throws {
    let body = try JSONEncoder().encode(
      CompleteAgentJobInput(leaseToken: leaseToken, completion: completion)
    )
    let _: CompleteAgentJobResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/jobs/complete",
      method: "POST",
      body: body
    )
  }

  func recordLogs(workspaceID: String, _ entries: [RelayLogEntry]) async throws {
    guard !entries.isEmpty else { return }
    let batch = RelayLogBatch(logs: entries.map { entry in
      RelayLogEnvelope(entry, workspaceID: workspaceID)
    })
    let _: LogReceipt = try await request(
      path: "/v1/workspaces/\(workspaceID)/logs",
      method: "POST",
      body: try JSONEncoder().encode(batch)
    )
  }

  private func request<Response: Decodable>(
    path: String,
    method: String,
    body: Data? = nil
  ) async throws -> Response {
    let url = URL(string: path, relativeTo: configuration.relayURL)!.absoluteURL
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 20
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    let sessionStore = KeychainSessionStore()
    var chiefSession = try? sessionStore.load()
    if let token = chiefSession?.accessToken {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    }
    var data: Data
    var response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      relayLog.error("\(method) \(path) failed: \(error.localizedDescription)")
      print("[Chief] relay \(method) \(path) failed: \(error.localizedDescription)")
      throw RelayError.unavailable
    }
    if let http = response as? HTTPURLResponse, http.statusCode == 401,
      let stored = chiefSession
    {
      let refreshed = try await refreshRelayToken(sessionToken: stored.sessionToken)
      chiefSession = ChiefSession(
        accessToken: refreshed,
        sessionToken: stored.sessionToken,
        user: stored.user,
        workspaceID: stored.workspaceID
      )
      if let chiefSession { try? sessionStore.save(chiefSession) }
      request.setValue("Bearer \(refreshed)", forHTTPHeaderField: "authorization")
      do {
        (data, response) = try await session.data(for: request)
      } catch {
        throw RelayError.unavailable
      }
    }
    guard let http = response as? HTTPURLResponse else {
      relayLog.error("\(method) \(path) non-HTTP response")
      throw RelayError.unavailable
    }
    guard (200..<300).contains(http.statusCode) else {
      let detail = String(data: data, encoding: .utf8) ?? ""
      relayLog.error("\(method) \(path) -> \(http.statusCode): \(detail.prefix(300))")
      print("[Chief] relay \(method) \(path) -> \(http.statusCode): \(detail.prefix(300))")
      if http.statusCode == 401 { throw RelayError.unauthorized }
      throw RelayError.httpStatus(http.statusCode)
    }
    relayLog.info("\(method) \(path) -> \(http.statusCode)")
    print("[Chief] relay \(method) \(path) -> \(http.statusCode)")
    if http.statusCode == 204 { throw RelayError.httpStatus(204) }
    return try decoder.decode(Response.self, from: data)
  }

  private func refreshRelayToken(sessionToken: String) async throws -> String {
    let url = configuration.authenticationAPIURL.appending(path: "convex/token")
    var request = URLRequest(url: url)
    request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "authorization")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
    else { throw RelayError.unauthorized }
    return try decoder.decode(RelayTokenEnvelope.self, from: data).token
  }
}

enum RelayError: Error, Equatable {
  case unauthorized
  case unavailable
  case httpStatus(Int)
}

private struct MessagePage: Codable { let messages: [ConversationMessage] }
private struct AppendMessageResult: Codable { let message: ConversationMessage }
private struct RelayTokenEnvelope: Codable { let token: String }
struct AgentJobLease: Codable, Equatable, Sendable {
  struct Job: Codable, Equatable, Sendable {
    let id: String
    let kind: String
  }
  let job: Job
  let leaseToken: String
}

private struct ClaimAgentJobInput: Codable {
  let workerId: String
  let leaseSeconds: Int
}

private struct CompleteAgentJobInput: Encodable {
  struct Outcome: Encodable {
    struct Result: Encodable {
      let openingMessage: String?
      let publishedMessage: AgentPublishedMessage?

      init(completion: AgentJobCompletion) {
        openingMessage = completion.openingMessage
        publishedMessage = completion.publishedMessage
      }
    }
    let status: String
    let result: Result
  }
  let leaseToken: String
  let outcome: Outcome

  init(leaseToken: String, completion: AgentJobCompletion) {
    self.leaseToken = leaseToken
    outcome = .init(status: "completed", result: .init(completion: completion))
  }
}

private struct CompleteAgentJobResult: Codable {}

private struct RelayLogEnvelope: Encodable {
  let id: String
  let correlationId: String
  let workspaceId: String
  let type: String
  let operation: String
  let agentId: String?
  let conversationId: String?
  let message: String
  let createdAt: String

  init(_ entry: RelayLogEntry, workspaceID: String) {
    id = entry.id
    correlationId = entry.correlationId
    workspaceId = workspaceID
    type = entry.type
    operation = entry.operation
    agentId = entry.agentId
    conversationId = entry.conversationId
    message = entry.message
    createdAt = entry.createdAt
  }
}

private struct RelayLogBatch: Encodable { let logs: [RelayLogEnvelope] }
private struct LogReceipt: Decodable { let accepted: Int }
private struct CreateWorkspaceInput: Codable {
  let commandId: String
  let name: String
  let website: String
  let runtime: String
  let inferenceProvider: String
  let inferenceModel: String
  let selectedApps: [String]

  init(draft: OnboardingDraft) {
    commandId = UUID().uuidString
    name = draft.companyName
    website = draft.website
    runtime = draft.runtime?.rawValue ?? "phone"
    inferenceProvider = draft.inferenceProvider?.rawValue ?? "openCodeGo"
    inferenceModel = draft.inferenceModel
    selectedApps = draft.selectedApps.sorted()
  }
}

private struct AppendMessageInput: Codable {
  struct Payload: Codable {
    let messageId: String
    let conversationId: String
    let threadRootId: String?
    let body: String
    let mentions: [String]
    let components: [MessageComponent]
  }
  let commandId: String
  let protocolVersion: Int
  let occurredAt: String
  let payload: Payload

  init(
    commandId: String,
    occurredAt: String,
    payload: Payload
  ) {
    self.commandId = commandId
    self.protocolVersion = 1
    self.occurredAt = occurredAt
    self.payload = payload
  }
}
