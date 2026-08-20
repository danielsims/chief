import Foundation

/// Relay-authoritative per-agent configuration, cached on-device per workspace
/// only so the owner UI and local runtime can start without a blank flash.
struct AgentConfig: Codable, Equatable, Sendable {
  var enabled: Bool = true
  var driver: String = "openCodeGo"
  var model: String = OpenCodeModelCatalog.recommendedFreeModelID
  var approvals: String = "auto" // auto | ask
  var capabilities: Set<String> = []
  var integrations: Set<String> = []
  var toolPermissions: Set<String> = [
    "workspace", "channels", "messages", "scheduled-work",
  ]

  static let allCapabilities = [
    "analytics-chart",
    "prospect-memory",
    "trend-memory",
    "content-calendar",
    "campaign-memory",
    "schedule-manager",
  ]

  static let allIntegrations = [
    "google-analytics",
    "google-ads",
    "slack",
    "github",
  ]

  static let allToolPermissions = [
    "workspace",  // agent_keys, members, channels
    "channels",  // create/archive channels
    "messages",  // post/reply/react to messages
    "scheduled-work",  // queue future jobs
    "advanced",  // code execution, browser
  ]

  /// Least-privilege defaults for a newly provisioned cell. Internal durable
  /// write grants stay out of the owner-facing generic permission list, but
  /// are preserved when that agent's configuration is edited and synced.
  static func defaults(for agentID: String) -> AgentConfig {
    var config = AgentConfig()
    switch agentID {
    case "brand":
      config.capabilities.insert("brand-memory")
      config.toolPermissions.formUnion(["advanced", "brand-profile-write"])
    case "prospector":
      config.capabilities.insert("prospect-memory")
      config.toolPermissions.formUnion(["advanced", "prospects-write"])
    default:
      break
    }
    return config
  }

  func permitsToolArea(_ area: String) -> Bool {
    enabled && toolPermissions.contains(area)
  }
}

/// On-device store for agent config, keyed by workspace + agent.
struct AgentConfigStore {
  private let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  func load(workspaceID: String, agentID: String) -> AgentConfig? {
    let key = "chief-agent-config:\(workspaceID):\(agentID)"
    guard let data = defaults.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(AgentConfig.self, from: data)
  }

  func save(workspaceID: String, agentID: String, config: AgentConfig) {
    let key = "chief-agent-config:\(workspaceID):\(agentID)"
    if let data = try? JSONEncoder().encode(config) {
      defaults.set(data, forKey: key)
    }
  }

  func clear(workspaceID: String) {
    let prefix = "chief-agent-config:\(workspaceID):"
    for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
      defaults.removeObject(forKey: key)
    }
  }
}
