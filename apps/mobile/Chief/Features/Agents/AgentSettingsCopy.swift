import SwiftUI

enum AgentSettingsCopy {
  static func displayName(_ value: String) -> String {
    switch value {
    case let permission where AgentToolPermissionID(rawValue: permission) != nil:
      AgentToolPermissionID(rawValue: permission)?.label ?? permission
    default: value.replacingOccurrences(of: "-", with: " ").capitalized
    }
  }

  static func permissionDetail(_ permission: String) -> String {
    AgentToolPermissionID(rawValue: permission)?.detail ?? "Grant this tool area to the agent"
  }
}
