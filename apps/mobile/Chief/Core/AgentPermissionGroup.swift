import Foundation

struct AgentPermissionGroup {
  let title: String
  let permissions: [String]

  static let all: [AgentPermissionGroup] = [
    ("Workspace", ["workspace"]),
    ("Projects", ["projects"]),
    ("Channels", ["channels", "members", "messages"]),
    ("Schedules", ["schedules", "webhooks"]),
    ("Connections", ["browser", "integrations"]),
    ("Agents", ["agents"]),
  ].map { title, areas in
    AgentPermissionGroup(title: title, permissions: AgentConfig.allToolPermissions.filter {
      areas.contains(String($0.split(separator: ".")[0]))
    })
  }
}
