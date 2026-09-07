import SwiftUI

enum AgentSettingsCopy {
  static func displayName(_ value: String) -> String {
    switch value {
    case "analytics-chart": "Analytics charts"
    case "prospect-memory": "Remember prospects"
    case "trend-memory": "Remember trends"
    case "content-calendar": "Content calendar"
    case "campaign-memory": "Campaign memory"
    case "schedule-manager": "Schedule manager"
    case let permission where AgentToolPermissionID(rawValue: permission) != nil:
      AgentToolPermissionID(rawValue: permission)?.label ?? permission
    default: value.replacingOccurrences(of: "-", with: " ").capitalized
    }
  }

  static func permissionDetail(_ permission: String) -> String {
    AgentToolPermissionID(rawValue: permission)?.detail ?? "Grant this tool area to the agent"
  }
}
