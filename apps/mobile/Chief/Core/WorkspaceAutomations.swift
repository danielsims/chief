import Foundation
import Observation

/// The work a schedule does (`automationSchema`): an ordered list of steps
/// that can branch. Lists nest instead of using free edges, so every
/// automation reads top to bottom.
struct WorkspaceAutomation: Codable, Equatable, Sendable {
  let steps: [AutomationStep]
}

/// One step (`automationStepSchema`), with the fields of its type set.
struct AutomationStep: Codable, Equatable, Identifiable, Sendable {
  enum Kind: String, Codable, Sendable { case agent, tool, condition, stop }

  struct Tool: Codable, Equatable, Sendable {
    /// `chief` or `plugin`.
    let source: String
    let name: String
    var connectionId: String?
    var readOnly: Bool?
  }

  struct Rule: Codable, Equatable, Sendable {
    let value: String
    let `operator`: String
    var compare: String?

    var comparesValue: Bool { `operator` != "is_empty" && `operator` != "is_not_empty" }

    /// Desktop's `operatorLabels`.
    var operatorLabel: String {
      switch `operator` {
      case "equals": "is"
      case "not_equals": "is not"
      case "contains": "contains"
      case "not_contains": "doesn’t contain"
      case "greater_than": "is more than"
      case "less_than": "is less than"
      case "is_empty": "is empty"
      case "is_not_empty": "has something"
      default: `operator`
      }
    }
  }

  let id: String
  let type: Kind
  let title: String
  var agentId: String?
  var prompt: String?
  var tool: Tool?
  var arguments: [String: JSONValue]?
  var when: Rule?
  var then: [AutomationStep]?
  var `else`: [AutomationStep]?
  /// `completed` or `skipped`.
  var outcome: String?

  /// A step nothing can follow: a stop, or a condition whose every branch stops.
  var ends: Bool {
    switch type {
    case .stop: true
    case .condition: then?.last?.ends == true && self.else?.last?.ends == true
    default: false
    }
  }
}

extension Array where Element == AutomationStep {
  /// Depth-first, in execution order, as `walkAutomation`.
  var walked: [AutomationStep] {
    flatMap { [$0] + ($0.then ?? []).walked + ($0.else ?? []).walked }
  }
}

/// What happened to one step during a run (`automationNodeStateSchema`).
struct AutomationNodeState: Codable, Equatable, Sendable {
  /// `pending`, `running`, `completed`, `failed` or `skipped`.
  let state: String
  var input: JSONValue?
  var output: JSONValue?
  var truncated: Bool?
  var error: String?
  /// A write a test only previewed: `output` is what it would have sent.
  var simulated: Bool?
  var runStepId: String?
  var startedAt: Double?
  var completedAt: Double?
}

struct AutomationRunState: Codable, Equatable, Sendable {
  let nodes: [String: AutomationNodeState]
}

/// A workspace plugin (`mcpConnectionSchema`), as much as automations show.
struct WorkspacePluginConnection: Decodable, Identifiable, Sendable {
  struct Tool: Decodable, Sendable {
    let name: String
    var title: String?
    var description: String?
    let readOnly: Bool
  }

  let id: String
  let name: String
  var domain: String?
  let status: String
  var tools: [Tool]?

  /// Desktop's `ProviderLogo` source: the canonical logo for the domain.
  var logoURL: URL? { domain.flatMap { URL(string: "https://integrations.sh/logo/\($0)") } }

  func tool(_ name: String) -> Tool? { tools?.first { $0.name == name } }
}

/// One of Chief's own tools an automation step can use.
struct AutomationChiefTool: Decodable, Sendable {
  let name: String
  var title: String?
  var description: String?
  let readOnly: Bool

  /// Desktop's `chiefToolLabel`.
  var label: String {
    guard let title = title?.trimmingCharacters(in: .whitespaces), !title.isEmpty else { return name }
    return title
  }
}

/// The workspace's plugins and Chief's automation tools, read at most once a
/// minute so a page full of automations and runs asks once, not once per row.
@MainActor
@Observable
final class AutomationCatalogue {
  static let shared = AutomationCatalogue()

  private(set) var plugins: [WorkspacePluginConnection] = []
  private(set) var chiefTools: [AutomationChiefTool] = []
  @ObservationIgnored private var loaded: (workspaceID: String, at: Date)?

  func load(workspaceID: String, relay: any RelayServing) async {
    if let loaded, loaded.workspaceID == workspaceID, Date.now.timeIntervalSince(loaded.at) < 60 {
      return
    }
    if loaded?.workspaceID != workspaceID {
      plugins = []
      chiefTools = []
    }
    loaded = (workspaceID, .now)
    async let plugins = try? relay.pluginConnections(workspaceID: workspaceID)
    async let tools = try? relay.automationTools(workspaceID: workspaceID)
    let (readPlugins, readTools) = await (plugins, tools)
    guard loaded?.workspaceID == workspaceID else { return }
    if let readPlugins { self.plugins = readPlugins }
    if let readTools { chiefTools = readTools }
    if readPlugins == nil || readTools == nil { loaded = nil }
  }

  func plugin(_ id: String?) -> WorkspacePluginConnection? {
    plugins.first { $0.id == id }
  }

  func chiefTool(_ name: String) -> AutomationChiefTool? {
    chiefTools.first { $0.name == name }
  }
}

extension RelayServing {
  func pluginConnections(workspaceID: String) async throws -> [WorkspacePluginConnection] {
    throw RelayError.unavailable
  }

  func automationTools(workspaceID: String) async throws -> [AutomationChiefTool] {
    throw RelayError.unavailable
  }

  func schedules(workspaceID: String, from: Double, to: Double) async throws -> [WorkspaceSchedule] {
    try await schedules(workspaceID: workspaceID)
  }
}

extension URLSessionRelayClient {
  func pluginConnections(workspaceID: String) async throws -> [WorkspacePluginConnection] {
    struct Result: Decodable { let connections: [WorkspacePluginConnection] }
    let result: Result = try await request(path: "/v1/workspaces/\(workspaceID)/plugins", method: "GET")
    return result.connections
  }

  func automationTools(workspaceID: String) async throws -> [AutomationChiefTool] {
    struct Result: Decodable { let tools: [AutomationChiefTool] }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/automation-tools", method: "GET")
    return result.tools
  }

  /// Schedules with the runs they recorded between `from` and `to` (at most 93 days apart).
  func schedules(workspaceID: String, from: Double, to: Double) async throws -> [WorkspaceSchedule] {
    let result: WorkspaceScheduleList = try await request(
      path: "/v1/workspaces/\(workspaceID)/schedules?from=\(Int(from))&to=\(Int(to))", method: "GET")
    return result.schedules
  }
}
