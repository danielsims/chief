import Foundation

/// Exact permission vocabulary shared conceptually with Chief's Executor.
/// Every native tool must map to one permission or it is denied by default.
enum AgentToolPermissionID: String, CaseIterable, Sendable {
  case workspaceRead = "workspace.read"
  case workspaceWrite = "workspace.write"
  case projectsRead = "projects.read"
  case projectsWrite = "projects.write"
  case channelsRead = "channels.read"
  case channelsCreate = "channels.create"
  case channelsUpdate = "channels.update"
  case channelsArchive = "channels.archive"
  case membersRead = "members.read"
  case membersManage = "members.manage"
  case messagesRead = "messages.read"
  case messagesSend = "messages.send"
  case messagesManage = "messages.manage"
  case schedulesRead = "schedules.read"
  case schedulesManage = "schedules.manage"
  case schedulesRun = "schedules.run"
  case webhooksManage = "webhooks.manage"
  case browserUse = "browser.use"
  case integrationsManage = "integrations.manage"
  case agentsDelegate = "agents.delegate"

  var label: String {
    switch self {
    case .workspaceRead: "Read workspace data"
    case .workspaceWrite: "Save workspace data"
    case .projectsRead: "Inspect projects"
    case .projectsWrite: "Work in projects"
    case .channelsRead: "View channels"
    case .channelsCreate: "Create channels"
    case .channelsUpdate: "Edit channels"
    case .channelsArchive: "Archive channels"
    case .membersRead: "View members"
    case .membersManage: "Manage members"
    case .messagesRead: "Read messages"
    case .messagesSend: "Send messages"
    case .messagesManage: "Manage own messages"
    case .schedulesRead: "View scheduled work"
    case .schedulesManage: "Manage scheduled work"
    case .schedulesRun: "Run scheduled work"
    case .webhooksManage: "Manage webhook triggers"
    case .browserUse: "Use the browser"
    case .integrationsManage: "Manage connections"
    case .agentsDelegate: "Delegate to agents"
    }
  }

  var detail: String {
    switch self {
    case .workspaceRead: "Read files, research, analytics, and saved work"
    case .workspaceWrite: "Create or update files, research, and content"
    case .projectsRead: "Read repository status, branches, and commits"
    case .projectsWrite: "Create isolated checkouts and commit changes"
    case .channelsRead: "Discover channels and read their activity"
    case .channelsCreate: "Create standard and feature channels"
    case .channelsUpdate: "Update channel details and workstream state"
    case .channelsArchive: "Archive or restore channels"
    case .membersRead: "See people and agents in a channel"
    case .membersManage: "Invite, remove, join, or leave channels"
    case .messagesRead: "Read and search channel conversations"
    case .messagesSend: "Post replies and add reactions"
    case .messagesManage: "Edit or delete messages created by this agent"
    case .schedulesRead: "Inspect schedules, runs, and trigger history"
    case .schedulesManage: "Create, update, pause, or remove schedules"
    case .schedulesRun: "Start, retry, or cancel scheduled runs"
    case .webhooksManage: "View and rotate local webhook credentials"
    case .browserUse: "Open and operate isolated visible browser sessions"
    case .integrationsManage: "Open setup flows and save credentials"
    case .agentsDelegate: "Start specialist work in another agent cell"
    }
  }
}

/// Host-issued capability for one agent turn. The model never receives or
/// controls this object; it only sees definitions that survive the grant.
struct AgentToolGrant: Sendable {
  let toolNames: Set<String>
  let permissions: Set<String>

  func permits(toolName: String) -> Bool {
    guard toolNames.contains(toolName),
      let permission = AgentToolAuthorization.permission(for: toolName)
    else { return false }
    return permissions.contains(permission.rawValue)
  }
}

enum AgentToolAuthorization {
  private static let permissionByTool: [String: AgentToolPermissionID] = [
    RelayChannelsListTool.name: .channelsRead,
    RelayWorkspaceMembersTool.name: .membersRead,
    RelayChannelCreateTool.name: .channelsCreate,
    RelayChannelMembersAddTool.name: .membersManage,
    RelayMessagesListTool.name: .messagesRead,
    RelayThreadRepliesTool.name: .messagesRead,
    RelayMessageSearchTool.name: .messagesRead,
    RelayMessagePostTool.name: .messagesSend,
    RelayReactionAddTool.name: .messagesSend,
    RelayReactionRemoveTool.name: .messagesSend,
    BrowserNavigateTool.name: .browserUse,
    BrowserSnapshotTool.name: .browserUse,
    BrowserClickTool.name: .browserUse,
    BrowserTypeTool.name: .browserUse,
    BrowserScrollTool.name: .browserUse,
    BrowserBackTool.name: .browserUse,
    BrowserReleaseTool.name: .browserUse,
    BrandProfileGetTool.name: .workspaceRead,
    BrandProfileSaveTool.name: .workspaceWrite,
    ProspectsListTool.name: .workspaceRead,
    ProspectSaveTool.name: .workspaceWrite,
    WorkspaceFilesListTool.name: .workspaceRead,
    PluginsListTool.name: .integrationsManage,
    PluginsRecommendTool.name: .integrationsManage,
    PluginsInstallTool.name: .integrationsManage,
    PluginsAuthorizeTool.name: .integrationsManage,
    PluginsUninstallTool.name: .integrationsManage,
  ]

  /// Until an explicit approval UI exists, `ask` is deliberately fail-closed
  /// for every tool that can mutate local, relay, or external browser state.
  private static let mutatingTools: Set<String> = [
    RelayChannelCreateTool.name,
    RelayChannelMembersAddTool.name,
    RelayMessagePostTool.name,
    RelayReactionAddTool.name,
    RelayReactionRemoveTool.name,
    BrowserNavigateTool.name,
    BrowserClickTool.name,
    BrowserTypeTool.name,
    BrowserScrollTool.name,
    BrowserBackTool.name,
    BrowserReleaseTool.name,
    BrandProfileSaveTool.name,
    ProspectSaveTool.name,
    PluginsRecommendTool.name,
    PluginsInstallTool.name,
    PluginsAuthorizeTool.name,
    PluginsUninstallTool.name,
  ]

  static func permission(for toolName: String) -> AgentToolPermissionID? {
    permissionByTool[toolName]
  }

  static func grant(
    requestedToolNames: Set<String>,
    config: AgentConfig
  ) -> AgentToolGrant {
    guard config.enabled else {
      return AgentToolGrant(toolNames: [], permissions: [])
    }
    let permissions = config.effectiveToolPermissions
    let granted = requestedToolNames.filter { toolName in
      guard let permission = permissionByTool[toolName],
        permissions.contains(permission.rawValue)
      else { return false }
      return config.approvals != "ask" || !mutatingTools.contains(toolName)
    }
    return AgentToolGrant(toolNames: Set(granted), permissions: permissions)
  }
}
