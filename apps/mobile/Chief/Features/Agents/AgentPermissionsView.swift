import SwiftUI

struct AgentPermissionsView: View {
  @Binding var config: AgentConfig
  let onChange: () -> Void

  var body: some View {
    SettingsPage {
      if config.deploymentTarget != "cloud" {
        VStack(alignment: .leading, spacing: 0) {
          SettingsToggle(
            title: "Allow workspace messages",
            detail: "Let other members and their agents message this personal agent.",
            isOn: config.messageAccess == "workspace"
          ) {
            config.messageAccess = config.messageAccess == "workspace" ? "owner" : "workspace"
            onChange()
          }
        }
      }
      ForEach(AgentPermissionGroup.all, id: \.title) { group in
        SettingsSection(title: group.title) {
          ForEach(group.permissions, id: \.self) { permission in
            SettingsToggle(
              title: AgentSettingsCopy.displayName(permission),
              detail: AgentSettingsCopy.permissionDetail(permission),
              isOn: config.toolPermissions.contains(permission)
            ) {
              if config.toolPermissions.contains(permission) {
                config.toolPermissions.remove(permission)
              } else {
                config.toolPermissions.insert(permission)
              }
              onChange()
            }
          }
        }
      }
    }
    .navigationTitle("Permissions")
  }
}
