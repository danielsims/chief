import Foundation

/// Capability set for one model turn. Configuration remains the persistent
/// workspace policy; this is the narrower, task-derived boundary enforced at
/// both tool advertisement and execution time.
enum AgentTurnToolPolicy {
  private static let collaboration = Set([
    RelayChannelsListTool.name,
    RelayWorkspaceMembersTool.name,
    RelayChannelCreateTool.name,
    RelayChannelMembersAddTool.name,
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

  static func names(
    requiresChiefDelegation: Bool,
    attachedSkillIDs: Set<String>
  ) -> Set<String> {
    if requiresChiefDelegation { return collaboration }
    if attachedSkillIDs.contains("build-brand-profile") {
      return collaboration.union(browser).union([
        BrandProfileGetTool.name,
        BrandProfileSaveTool.name,
        WorkspaceFilesListTool.name,
      ])
    }
    if attachedSkillIDs.contains("find-buying-signals") {
      return collaboration.union(browser).union([
        BrandProfileGetTool.name,
        ProspectsListTool.name,
        ProspectSaveTool.name,
        WorkspaceFilesListTool.name,
      ])
    }
    return collaboration
  }
}
