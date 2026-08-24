import SwiftUI

/// Mobile agent settings follow the native iOS hierarchy: a compact overview
/// pushes full-width Configuration, Channels, Permissions, and Deployment
/// pages. Relay configuration remains authoritative across every device.
struct AgentDetailView: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary

  @State private var config: AgentConfig
  @State private var saving = false
  @State private var saveFailed = false

  init(agent: AgentSummary) {
    self.agent = agent
    _config = State(initialValue: AgentConfig.defaults(for: agent.id))
  }

  var body: some View {
    List {
      Section { agentIdentity }

      Section {
        ChiefBooleanRow(
          title: "Agent active",
          detail: "Handles work and replies in this workspace",
          isOn: config.enabled
        ) {
          config.enabled.toggle()
          persist()
        }
      }

      Section {
        NavigationLink {
          AgentConfigurationView(config: $config, onChange: persist)
        } label: {
          AgentSettingsDestination(
            icon: "slider.horizontal.3",
            title: "Configuration",
            detail: config.model
          )
        }
        .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })

        NavigationLink {
          AgentChannelsView(agent: agent)
        } label: {
          AgentSettingsDestination(
            icon: "number",
            title: "Channels",
            detail: "Where this agent can participate"
          )
        }
        .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })

        NavigationLink {
          AgentPermissionsView(config: $config, onChange: persist)
        } label: {
          AgentSettingsDestination(
            icon: "hand.raised",
            title: "Permissions",
            detail: "\(config.toolPermissions.count) tool grants"
          )
        }
        .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })

        NavigationLink {
          AgentDeploymentView(agent: agent, config: config)
        } label: {
          AgentSettingsDestination(
            icon: "server.rack",
            title: "Deployment",
            detail: "On this iPhone"
          )
        }
        .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
      }
    }
    .scrollContentBackground(.hidden)
    .background(ChiefTheme.background)
    .navigationTitle(agent.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if saving {
        ToolbarItem(placement: .topBarTrailing) {
          ProgressView().controlSize(.small)
        }
      }
    }
    .task(id: agent.id) {
      config = model.agentConfig(agentID: agent.id)
      config = await model.refreshAgentConfig(agentID: agent.id)
    }
    .alert("Couldn’t save changes", isPresented: $saveFailed) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("The relay didn’t accept this agent configuration. Your previous settings were restored.")
    }
  }

  private var agentIdentity: some View {
    HStack(spacing: 14) {
      AgentMark(name: agent.name, size: 52, working: agent.status == .working)
      VStack(alignment: .leading, spacing: 3) {
        Text(agent.name)
          .font(.system(size: 20, weight: .semibold, design: .rounded))
        Text(agent.role)
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
        Text(agent.status == .working ? "Working now" : "Available")
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.tertiary)
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

private struct AgentSettingsDestination: View {
  let icon: String
  let title: String
  let detail: String

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.system(size: 15, weight: .medium))
        Text(detail)
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(1)
      }
    }
    .padding(.vertical, 2)
  }
}

private struct AgentConfigurationView: View {
  @Binding var config: AgentConfig
  let onChange: () -> Void

  var body: some View {
    List {
      Section("Inference") {
        LabeledContent("Model", value: config.model)
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
      }

      Section("Capabilities") {
        ForEach(AgentConfig.allCapabilities, id: \.self) { capability in
          ChiefBooleanRow(
            title: AgentSettingsCopy.displayName(capability),
            isOn: config.capabilities.contains(capability)
          ) {
            toggle(capability, in: &config.capabilities)
          }
        }
      }

      Section("Connections") {
        ForEach(AgentConfig.allIntegrations, id: \.self) { integration in
          ChiefBooleanRow(
            title: AgentSettingsCopy.displayName(integration),
            isOn: config.integrations.contains(integration)
          ) {
            toggle(integration, in: &config.integrations)
          }
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(ChiefTheme.background)
    .navigationTitle("Configuration")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func toggle(_ value: String, in values: inout Set<String>) {
    if values.contains(value) { values.remove(value) } else { values.insert(value) }
    onChange()
  }
}

private struct AgentChannelRow: Identifiable {
  let conversation: ConversationSummary
  var isMember: Bool
  var id: String { conversation.id }
}

private struct AgentChannelsView: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary

  @State private var rows: [AgentChannelRow] = []
  @State private var loading = true

  var body: some View {
    List {
      Section {
        if loading {
          HStack {
            Spacer()
            ProgressView()
            Spacer()
          }
        } else if rows.isEmpty {
          Text("No channels yet")
            .foregroundStyle(ChiefTheme.secondary)
        } else {
          ForEach(rows) { row in
            Toggle(isOn: membershipBinding(for: row.id)) {
              HStack(spacing: 10) {
                Image(systemName: row.conversation.isPrivate ? "lock" : "number")
                  .foregroundStyle(ChiefTheme.secondary)
                  .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                  Text(row.conversation.name)
                  Text(row.conversation.isPrivate ? "Private channel" : "Channel")
                    .font(.system(size: 12))
                    .foregroundStyle(ChiefTheme.secondary)
                }
              }
            }
            .toggleStyle(.switch)
            .tint(ChiefTheme.toggleOn)
          }
        }
      } footer: {
        Text("Channel access is enforced by the relay. Turning a channel off removes this agent from its membership list.")
      }
    }
    .scrollContentBackground(.hidden)
    .background(ChiefTheme.background)
    .navigationTitle("Channels")
    .navigationBarTitleDisplayMode(.inline)
    .task { await load() }
  }

  private func membershipBinding(for conversationID: String) -> Binding<Bool> {
    Binding(
      get: { rows.first(where: { $0.id == conversationID })?.isMember ?? false },
      set: { value in
        guard let index = rows.firstIndex(where: { $0.id == conversationID }),
          rows[index].isMember != value
        else { return }
        Haptics.selection()
        rows[index].isMember = value
        Task {
          let saved = await model.setAgentMembership(
            conversationID: conversationID,
            agentID: agent.id,
            isMember: value
          )
          if saved {
            Haptics.success()
          } else {
            if let current = rows.firstIndex(where: { $0.id == conversationID }) {
              rows[current].isMember = !value
            }
            Haptics.error()
          }
        }
      }
    )
  }

  private func load() async {
    let memberships = await model.allChannelMemberships()
    let memberConversationIDs = Set(
      memberships
        .filter { $0.kind == "agent" && $0.principalId == agent.id }
        .map(\.conversationId)
    )
    rows = (model.workspace?.conversations ?? [])
      .filter { $0.kind == .channel && !$0.archived }
      .map {
        AgentChannelRow(
          conversation: $0,
          isMember: memberConversationIDs.contains($0.id)
        )
      }
    loading = false
  }
}

private struct AgentPermissionsView: View {
  @Binding var config: AgentConfig
  let onChange: () -> Void

  var body: some View {
    List {
      Section {
        ForEach(AgentConfig.allToolPermissions, id: \.self) { permission in
          ChiefBooleanRow(
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
      } footer: {
        Text("Every tool call is checked against these grants by the runtime and again at the relay boundary.")
      }
    }
    .scrollContentBackground(.hidden)
    .background(ChiefTheme.background)
    .navigationTitle("Permissions")
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct AgentDeploymentView: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary
  let config: AgentConfig

  @State private var showsCloudflareNotice = false

  var body: some View {
    List {
      Section("Runtime") {
        deploymentOption(
          icon: "iphone.gen3",
          title: "Cell",
          detail: "Runs on this iPhone",
          selected: true
        ) {
          Haptics.selection()
        }

        deploymentOption(
          icon: "cloud",
          title: "Cloudflare",
          detail: "Hosted dedicated cell",
          badge: "Soon",
          selected: false
        ) {
          Haptics.medium()
          showsCloudflareNotice = true
        }
      }

      Section("Cell details") {
        LabeledContent("Agent", value: agent.name)
        LabeledContent("Model", value: config.model)
        LabeledContent("Workspace", value: model.workspace?.name ?? "Unavailable")
      }

      Section {
        Text("Each agent always remains one isolated cell with its own database, identity, mailbox, and job queue. Changing where it runs will never combine multiple agents into one runtime.")
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
      }
    }
    .scrollContentBackground(.hidden)
    .background(ChiefTheme.background)
    .navigationTitle("Deployment")
    .navigationBarTitleDisplayMode(.inline)
    .alert("Cloudflare deployment isn’t connected yet", isPresented: $showsCloudflareNotice) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("Hosted provisioning will appear here once Chief can create and verify a dedicated Cloudflare cell. This agent continues running safely on this iPhone.")
    }
  }

  private func deploymentOption(
    icon: String,
    title: String,
    detail: String,
    badge: String? = nil,
    selected: Bool,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: icon)
          .font(.system(size: 18, weight: .medium))
          .foregroundStyle(ChiefTheme.secondary)
          .frame(width: 28)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 7) {
            Text(title).font(.system(size: 15, weight: .medium))
            if let badge {
              Text(badge)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(ChiefTheme.secondary)
                .padding(.horizontal, 6)
                .frame(height: 19)
                .background(ChiefTheme.elevated, in: Capsule())
            }
          }
          Text(detail)
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
        }
        Spacer()
        if selected {
          Image(systemName: "checkmark")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(ChiefTheme.accent)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

private enum AgentSettingsCopy {
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
