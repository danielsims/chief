import SwiftUI

/// Mobile agent settings follow the native iOS hierarchy: a compact overview
/// pushes Configuration, Channels, Permissions, and specialist detail
/// pages. Relay configuration remains authoritative across every device.
struct AgentDetailView: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary

  @State private var config: AgentConfig
  @State private var saving = false
  @State private var loadingConfig = true
  @State private var saveFailed = false
  init(agent: AgentSummary, highlightedSubagentID: String? = nil) {
    let destination = agent.detailAgent(for: highlightedSubagentID)
    self.agent = destination
    _config = State(initialValue: AgentConfig.defaults(for: destination.id))
  }

  var body: some View {
    SettingsPage {
      agentIdentity

      SettingsSection(title: "Activity") {
        SettingsRow {
          ChiefBooleanRow(
            title: "Agent active", detail: "Handles work and replies", isOn: config.enabled
          ) {
            config.enabled.toggle()
            persist()
          }
        }
      }
      SettingsSection(title: "Settings") {
        NavigationLink {
          AgentConfigurationView(config: $config, onChange: persist)
        } label: {
          SettingsDestination(
            title: "Configuration", icon: "slider.horizontal.3", detail: config.model)
        }.buttonStyle(.plain)
        NavigationLink {
          AgentChannelsView(agent: agent)
        } label: {
          SettingsDestination(title: "Channels", icon: "number")
        }.buttonStyle(.plain)
        NavigationLink {
          AgentPermissionsView(config: $config, onChange: persist)
        } label: {
          SettingsDestination(title: "Permissions", icon: "hand.raised")
        }.buttonStyle(.plain)
      }
      if !agent.subagents.isEmpty {
        SettingsSection(title: "Subagents") {
          ForEach(agent.subagents) { specialist in
            NavigationLink {
              AgentDetailView(agent: agent, highlightedSubagentID: specialist.id)
            } label: {
              SettingsRow {
                AgentMark(
                  name: specialist.name, size: 28,
                  working: model.isAgentWorking(agentID: specialist.id))
                VStack(alignment: .leading, spacing: 3) {
                  Text(specialist.name).foregroundStyle(ChiefTheme.accent)
                  Text(specialist.role).font(.system(size: 12)).foregroundStyle(
                    ChiefTheme.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(
                  ChiefTheme.tertiary)
              }
            }.buttonStyle(.plain)
              .accessibilityIdentifier("subagent-detail-\(specialist.id)")
          }
        }
      }
    }
    .disabled(saving || loadingConfig)
    .navigationTitle(agent.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if saving || loadingConfig {
        ToolbarItem(placement: .topBarTrailing) {
          ProgressView().controlSize(.small)
        }
      }
    }
    .task(id: agent.id) {
      loadingConfig = true
      config = model.agentConfig(agentID: agent.id)
      config = await model.refreshAgentConfig(agentID: agent.id)
      loadingConfig = false
    }
    .alert("Couldn’t save changes", isPresented: $saveFailed) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("The relay didn’t accept this agent configuration. Please try again.")
    }
  }

  private var agentIdentity: some View {
    HStack(alignment: .top, spacing: 14) {
      AgentMark(name: agent.name, size: 52, working: model.isAgentWorking(agentID: agent.id))
      VStack(alignment: .leading, spacing: 3) {
        Text(agent.name)
          .font(.system(size: 22, weight: .regular, design: .rounded))
        Text(agent.role)
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
        if let count = agent.subagentCountLabel {
          Text(count)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(ChiefTheme.secondary)
        }
        Text(model.isAgentWorking(agentID: agent.id) ? "Working now" : "Available")
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.tertiary)
        if !agent.description.isEmpty {
          Text(agent.description)
            .font(.system(size: 13))
            .foregroundStyle(ChiefTheme.secondary)
            .padding(.top, 4)
        }
      }
    }
    .padding(.vertical, 6)
  }

  private func persist() {
    let pending = config
    saving = true
    saveFailed = false
    Task {
      let saved = await model.saveAgentConfig(agentID: agent.id, config: pending)
      saving = false
      saveFailed = !saved
      if saved {
        Haptics.success()
      } else {
        config = await model.refreshAgentConfig(agentID: agent.id)
        Haptics.error()
      }
    }
  }
}
