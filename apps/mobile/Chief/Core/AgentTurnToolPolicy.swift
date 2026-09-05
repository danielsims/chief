import Foundation

/// Capability set for one model turn. Configuration remains the persistent
/// workspace policy; this is the narrower, task-derived boundary enforced at
/// both tool advertisement and execution time.
enum AgentTurnToolPolicy {
  private static let readOnly = Set([
    RelayChannelsListTool.name,
    RelayMessagesListTool.name,
    RelayThreadRepliesTool.name,
    RelayMessageSearchTool.name,
    BrowserSnapshotTool.name,
    BrandProfileGetTool.name,
    ProspectsListTool.name,
    WorkspaceFilesListTool.name,
    PluginsListTool.name,
  ])

  private static let conversation = Set([
    WorkspaceFilesListTool.name,
    WorkspaceFileWriteTool.name,
    RelayChannelJoinTool.name,
    RelayChannelsListTool.name,
    RelayMessagesListTool.name,
    RelayMessagePostTool.name,
    RelayThreadRepliesTool.name,
    RelayMessageSearchTool.name,
    RelayReactionAddTool.name,
    RelayReactionRemoveTool.name,
  ])

  private static let browser = Set([
    BrowserNavigateTool.name,
    BrowserSnapshotTool.name,
    BrowserClickTool.name,
    BrowserTypeTool.name,
    BrowserScrollTool.name,
    BrowserBackTool.name,
    BrowserReleaseTool.name,
  ])

  /// Plugin discovery and user-approved connection are workspace capabilities,
  /// not Setup-only capabilities. Any agent may recommend a useful provider
  /// and must be able to finish the card action the user explicitly approves.
  private static let plugins = Set([
    PluginsListTool.name,
    PluginsRecommendTool.name,
    PluginsInstallTool.name,
    PluginsAuthorizeTool.name,
  ])

  private static let pluginAdministration = Set([
    PluginsUninstallTool.name
  ])

  static func names(
    requiresChiefDelegation: Bool,
    requiresSpecialistKickoff: Bool = false,
    attachedSkillIDs: Set<String>,
    agentID: String? = nil
  ) -> Set<String> {
    var names = conversation
    names.formUnion(plugins)
    if requiresChiefDelegation {
      names.formUnion([
        RelayWorkspaceMembersTool.name,
        RelayChannelMembersAddTool.name,
      ])
    }
    if requiresSpecialistKickoff {
      names.formUnion([
        RelayWorkspaceMembersTool.name,
        RelayChannelCreateTool.name,
        RelayChannelMembersAddTool.name,
      ])
    }
    if attachedSkillIDs.contains("build-brand-profile") {
      names.formUnion(browser)
      names.formUnion([
        BrandProfileGetTool.name,
        BrandProfileSaveTool.name,
        WorkspaceFilesListTool.name,
      ])
    }
    if attachedSkillIDs.contains("find-buying-signals") {
      names.formUnion(browser)
      names.formUnion([
        BrandProfileGetTool.name,
        ProspectsListTool.name,
        ProspectSaveTool.name,
        WorkspaceFilesListTool.name,
      ])
    }
    // The authored agent identity is also a durable capability boundary. These
    // baseline tools let specialists act proactively on ordinary turns, while
    // the relay-authored config and approval mode still gate every call.
    switch agentID {
    case "brand":
      names.formUnion(browser)
      names.formUnion([
        BrandProfileGetTool.name,
        BrandProfileSaveTool.name,
        WorkspaceFilesListTool.name,
      ])
    case "prospector":
      names.formUnion(browser)
      names.formUnion([
        BrandProfileGetTool.name,
        ProspectsListTool.name,
        ProspectSaveTool.name,
        WorkspaceFilesListTool.name,
      ])
    case "setup", "ads":
      names.formUnion(browser)
      names.formUnion(pluginAdministration)
    default:
      break
    }
    return names
  }

  static func isReadOnly(_ toolName: String) -> Bool {
    readOnly.contains(toolName)
  }
}
