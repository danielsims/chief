import Foundation

struct AgentInferenceConfig: Codable, Equatable, Sendable {
  var provider: String
  var model: String
}

/// Relay-authoritative per-agent configuration, cached on-device per workspace
/// only so the owner UI and local runtime can start without a blank flash.
struct AgentConfig: Codable, Equatable, Sendable {
  var enabled: Bool = true
  var deploymentTarget: String = "cloud"
  var inference = AgentInferenceConfig(
    provider: "opencode",
    model: "opencode-go/deepseek-v4-flash"
  )
  var approvals: String = "auto"  // auto | ask
  var capabilities: Set<String> = []
  var integrations: Set<String> = []
  var toolPermissions: Set<String> = AgentConfig.baseToolPermissions

  var driver: String {
    get { inference.provider }
    set { inference.provider = newValue }
  }

  var model: String {
    get { inference.model }
    set { inference.model = newValue }
  }

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

  static let allToolPermissions = AgentToolPermissionID.allCases.map(\.rawValue)

  private static let baseToolPermissions: Set<String> = [
    AgentToolPermissionID.workspaceRead.rawValue,
    AgentToolPermissionID.channelsRead.rawValue,
    AgentToolPermissionID.channelsCreate.rawValue,
    AgentToolPermissionID.membersRead.rawValue,
    AgentToolPermissionID.membersManage.rawValue,
    AgentToolPermissionID.messagesRead.rawValue,
    AgentToolPermissionID.messagesSend.rawValue,
    AgentToolPermissionID.integrationsManage.rawValue,
  ]

  /// Least-privilege defaults for a newly provisioned cell. Internal durable
  /// write grants stay out of the owner-facing generic permission list, but
  /// are preserved when that agent's configuration is edited and synced.
  static func defaults(for agentID: String) -> AgentConfig {
    var config = AgentConfig()
    switch agentID {
    case "chief":
      config.toolPermissions.formUnion([
        AgentToolPermissionID.workspaceWrite.rawValue,
        AgentToolPermissionID.channelsUpdate.rawValue,
        AgentToolPermissionID.channelsArchive.rawValue,
        AgentToolPermissionID.messagesManage.rawValue,
        AgentToolPermissionID.schedulesRead.rawValue,
        AgentToolPermissionID.schedulesManage.rawValue,
        AgentToolPermissionID.schedulesRun.rawValue,
        AgentToolPermissionID.agentsDelegate.rawValue,
      ])
    case "brand":
      config.capabilities.insert("brand-memory")
      config.toolPermissions.formUnion([
        AgentToolPermissionID.workspaceWrite.rawValue,
        AgentToolPermissionID.browserUse.rawValue,
      ])
    case "prospector":
      config.capabilities.insert("prospect-memory")
      config.toolPermissions.formUnion([
        AgentToolPermissionID.workspaceWrite.rawValue,
        AgentToolPermissionID.browserUse.rawValue,
      ])
    case "engineer":
      config.toolPermissions.formUnion([
        AgentToolPermissionID.projectsRead.rawValue,
        AgentToolPermissionID.projectsWrite.rawValue,
      ])
    case "setup":
      config.toolPermissions.formUnion([
        AgentToolPermissionID.browserUse.rawValue,
        AgentToolPermissionID.integrationsManage.rawValue,
      ])
    default:
      break
    }
    return config
  }

  /// Transitional expansion for E2E workspaces saved before exact Executor
  /// permissions landed. New writes use only the exact dotted vocabulary.
  var effectiveToolPermissions: Set<String> {
    var result = toolPermissions
    // Plugin recommendation is a baseline workspace capability. Existing
    // workspaces created before that policy shipped are upgraded locally so
    // every authored agent can render and complete a user-approved card.
    result.insert(AgentToolPermissionID.integrationsManage.rawValue)
    let legacy: [String: Set<String>] = [
      "workspace": ["workspace.read", "workspace.write", "members.read"],
      "channels": [
        "channels.read", "channels.create", "channels.update",
        "channels.archive", "members.read", "members.manage",
      ],
      "messages": ["messages.read", "messages.send", "messages.manage"],
      "scheduled-work": ["schedules.read", "schedules.manage", "schedules.run"],
      "advanced": ["browser.use"],
      "brand-profile-write": ["workspace.write"],
      "prospects-write": ["workspace.write"],
    ]
    for (old, exact) in legacy where result.contains(old) {
      result.formUnion(exact)
    }
    return result
  }

  var normalized: AgentConfig {
    var copy = self
    let legacy = Set([
      "workspace", "channels", "messages", "scheduled-work", "advanced",
      "brand-profile-write", "prospects-write",
    ])
    copy.toolPermissions = effectiveToolPermissions.subtracting(legacy)
    return copy
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
    return try? JSONDecoder().decode(AgentConfig.self, from: data).normalized
  }

  func save(workspaceID: String, agentID: String, config: AgentConfig) {
    let key = "chief-agent-config:\(workspaceID):\(agentID)"
    if let data = try? JSONEncoder().encode(config.normalized) {
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
