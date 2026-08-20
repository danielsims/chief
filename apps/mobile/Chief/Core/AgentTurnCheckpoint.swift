import Foundation
import os

/// The mutable, recoverable portion of one agent turn. It is written into the
/// owning agent cell after every reasoning or tool boundary. The cell worker
/// promotes it into immutable session history after interruption, matching
/// eve's durable step/replay model without exposing trusted host secrets to the
/// JavaScript worker.
actor AgentTurnCheckpoint {
  private static let logger = Logger(
    subsystem: "sh.heychief.mobile",
    category: "AgentCheckpoint"
  )
  private struct Snapshot: Encodable {
    let version = 1
    let id: String
    let sessionId: String
    let turnId: String
    let userAt: Int64
    let startedAtMs: Int64
    let updatedAtMs: Int64
    let status: String
    let text: String
    let activities: [Activity]
    let error: String?
  }

  private struct Activity: Encodable {
    let id: String
    let kind: String
    let startedAtMs: Int64
    var updatedAtMs: Int64
    var status: String
    var text: String?
    var tool: ToolStep?
  }

  private struct ToolStep: Encodable {
    let id: String
    let name: String
    let input: String
    var output: String?
    var error: String?
  }

  let scope: String
  let conversationID: String
  let sessionID: String
  let turnID: String
  private let world: any AgentWorkflowWorld

  private let checkpointID = UUID().uuidString.lowercased()
  private let userAt: Int64
  private let startedAtMs: Int64
  private var status = "running"
  private var text = ""
  private var activities: [Activity] = []
  private var error: String?
  private var lastPersistedAtMs: Int64?

  init(
    scope: String,
    conversationID: String,
    userAt: Int64,
    world: any AgentWorkflowWorld = CelldWorkflowWorld()
  ) {
    self.scope = scope
    self.conversationID = conversationID
    sessionID = "\(scope):\(conversationID)"
    turnID = "turn:\(userAt)"
    self.userAt = userAt
    self.world = world
    startedAtMs = Int64(Date().timeIntervalSince1970 * 1_000)
  }

  func begin() throws {
    guard persist(force: true) else { throw ChiefCellError.storageUnavailable }
  }

  func appendReasoning(id: String, delta: String) {
    guard !delta.isEmpty else { return }
    let now = Self.nowMilliseconds()
    if let index = activities.indices.last,
      activities[index].kind == "reasoning",
      activities[index].id == id
    {
      activities[index].text = (activities[index].text ?? "") + delta
      activities[index].updatedAtMs = now
    } else {
      activities.append(
        Activity(
          id: id,
          kind: "reasoning",
          startedAtMs: now,
          updatedAtMs: now,
          status: "running",
          text: delta,
          tool: nil
        )
      )
    }
    persist()
  }

  func finishReasoning(id: String) {
    update(id: id, force: true) { activity in activity.status = "completed" }
  }

  func beginTool(id: String, name: String, input: String) {
    let now = Self.nowMilliseconds()
    activities.append(
      Activity(
        id: "tool-\(id)",
        kind: "tool",
        startedAtMs: now,
        updatedAtMs: now,
        status: "running",
        text: nil,
        tool: ToolStep(id: id, name: name, input: input, output: nil, error: nil)
      )
    )
    persist(force: true)
  }

  func finishTool(id: String, output: String, error: String?) {
    update(id: "tool-\(id)", force: true) { activity in
      activity.status = error == nil ? "completed" : "failed"
      activity.tool?.output = output
      activity.tool?.error = error
    }
  }

  func finish(text: String) {
    self.text = text
    status = "completed"
    persist(force: true)
  }

  func fail(_ failure: AgentRunFailure) {
    status = "failed"
    error = failure.message
    persist(force: true)
  }

  private func update(
    id: String,
    force: Bool = false,
    mutation: (inout Activity) -> Void
  ) {
    guard let index = activities.firstIndex(where: { $0.id == id }) else { return }
    mutation(&activities[index])
    activities[index].updatedAtMs = Self.nowMilliseconds()
    persist(force: force)
  }

  @discardableResult
  private func persist(force: Bool = false) -> Bool {
    let now = Self.nowMilliseconds()
    if !force, let lastPersistedAtMs, now - lastPersistedAtMs < 250 { return true }
    lastPersistedAtMs = now
    let snapshot = Snapshot(
      id: checkpointID,
      sessionId: sessionID,
      turnId: turnID,
      userAt: userAt,
      startedAtMs: startedAtMs,
      updatedAtMs: now,
      status: status,
      text: text,
      activities: activities,
      error: error
    )
    guard let data = try? JSONEncoder().encode(snapshot) else {
      Self.logger.fault("Could not encode the active agent turn checkpoint.")
      return false
    }
    let persisted = world.put(
      scope: scope,
      conversationID: conversationID,
      key: "activeTurn",
      json: String(decoding: data, as: UTF8.self)
    )
    if !persisted {
      Self.logger.fault("Could not persist the active agent turn checkpoint.")
    }
    return persisted
  }

  private static func nowMilliseconds() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1_000)
  }
}

/// Storage port matching eve's workflow-world boundary. A hosted cell can use
/// another implementation without changing agent or turn semantics.
protocol AgentWorkflowWorld: Sendable {
  @discardableResult
  func put(scope: String, conversationID: String, key: String, json: String) -> Bool
}

struct CelldWorkflowWorld: AgentWorkflowWorld {
  func put(scope: String, conversationID: String, key: String, json: String) -> Bool {
    ChiefCellStorage.put(
      scope: scope,
      conversationID: conversationID,
      key: key,
      json: json
    )
  }
}

/// Narrow trusted-runtime port into one cell's SQLite storage. Values are
/// namespaced by agent cell and conversation before they cross the C boundary.
enum ChiefCellStorage {
  @discardableResult
  static func put(
    scope: String,
    conversationID: String,
    key: String,
    json: String
  ) -> Bool {
    guard ChiefCellRuntime.isSafeScope(scope), isSafeKey(conversationID), isSafeKey(key)
    else { return false }
    return CelldC.storagePut(
      scope: "AgentCell:\(scope)",
      key: "conversation:\(conversationID):\(key)",
      json: json
    )
  }

  private static func isSafeKey(_ value: String) -> Bool {
    value.range(
      of: #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"#,
      options: .regularExpression
    ) != nil
  }
}
