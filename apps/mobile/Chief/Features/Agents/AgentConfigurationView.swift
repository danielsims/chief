import SwiftUI

struct AgentConfigurationView: View {
  @Binding var config: AgentConfig
  let onChange: () -> Void

  var body: some View {
    SettingsPage {
      SettingsSection(title: "Inference") {
        SettingsRow { LabeledContent("Model", value: config.model).font(.system(size: 13)) }
        Picker(
          "Approval",
          selection: Binding(
            get: { config.approvals },
            set: { value in
              guard value != config.approvals else { return }
              Haptics.selection()
              config.approvals = value
              onChange()
            }
          )
        ) {
          Text("Automatic").tag("auto")
          Text("Ask me").tag("ask")
        }
        .pickerStyle(.menu)
        .padding(.vertical, 12)
      }

      SettingsSection(title: "Capabilities") {
        ForEach(AgentConfig.allCapabilities, id: \.self) { capability in
          SettingsToggle(
            title: AgentSettingsCopy.displayName(capability),
            isOn: config.capabilities.contains(capability)
          ) {
            toggle(capability, in: &config.capabilities)
          }
        }
      }

      SettingsSection(title: "Connections") {
        ForEach(AgentConfig.allIntegrations, id: \.self) { integration in
          SettingsToggle(
            title: AgentSettingsCopy.displayName(integration),
            isOn: config.integrations.contains(integration)
          ) {
            toggle(integration, in: &config.integrations)
          }
        }
      }
    }
    .navigationTitle("Configuration")
  }

  private func toggle(_ value: String, in values: inout Set<String>) {
    if values.contains(value) { values.remove(value) } else { values.insert(value) }
    onChange()
  }
}
