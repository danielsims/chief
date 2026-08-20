import SwiftUI

/// Agent roster -> detail: a full-width nested page (back button) for a single
/// agent with Configuration / Channels / Permissions tabs. Every edit persists
/// locally per workspace and syncs to the relay so the same agent stays
/// configured across devices. Mirrors the desktop agent-detail page's tabs;
/// there are no Playbooks on mobile.
struct AgentDetailView: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary

  @State private var config: AgentConfig
  @State private var tab: AgentDetailTab = .configuration
  @State private var channelRows: [AgentChannelRow] = []
  @State private var membershipsLoaded = false
  @State private var saving = false
  @State private var saveFailed = false

  init(agent: AgentSummary) {
    self.agent = agent
    _config = State(initialValue: AgentConfig.defaults(for: agent.id))
  }

  private enum AgentDetailTab: String, CaseIterable {
    case configuration = "Configuration"
    case channels = "Channels"
    case permissions = "Permissions"
  }

  private struct AgentChannelRow: Identifiable {
    let conversation: ConversationSummary
    let isMember: Bool
    var id: String { conversation.id }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        header
        tabBar
        switch tab {
        case .configuration: configurationTab
        case .channels: channelsTab
        case .permissions: permissionsTab
        }
      }
      .padding(ChiefTheme.pagePadding)
    }
    .background(ChiefTheme.background)
    .navigationTitle(agent.name)
    .navigationBarTitleDisplayMode(.inline)
    .task(id: agent.id) {
      config = model.agentConfig(agentID: agent.id)
      config = await model.refreshAgentConfig(agentID: agent.id)
      loadChannelRows()
    }
  }

  // MARK: - Header

  private var header: some View {
    HStack(alignment: .top, spacing: 14) {
      AgentMark(name: agent.name, size: 56, working: agent.status == .working)
      VStack(alignment: .leading, spacing: 3) {
        Text(agent.name)
          .font(.system(size: 22, weight: .semibold, design: .rounded))
          .tracking(-0.4)
        Text(agent.role)
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
        Text("Agent · \(config.model)")
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      Spacer()
      if saving {
        ProgressView()
          .controlSize(.small)
          .accessibilityLabel("Saving agent configuration")
      } else if saveFailed {
        Image(systemName: "exclamationmark.circle.fill")
          .foregroundStyle(.red)
          .accessibilityLabel("Agent configuration could not be saved")
      }
    }
  }

  // MARK: - Tabs

  private var tabBar: some View {
    HStack(spacing: 0) {
      ForEach(AgentDetailTab.allCases, id: \.self) { tab in
        Button {
          Haptics.medium()
          withAnimation(.easeOut(duration: 0.15)) { self.tab = tab }
        } label: {
          Text(tab.rawValue)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(self.tab == tab ? ChiefTheme.accent : ChiefTheme.secondary)
            .frame(maxWidth: .infinity)
            .frame(height: 42)
            .overlay(alignment: .bottom) {
              Rectangle()
                .fill(self.tab == tab ? ChiefTheme.accent : .clear)
                .frame(height: 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
    .overlay(alignment: .bottom) { Rectangle().fill(ChiefTheme.line).frame(height: 0.5) }
  }

  // MARK: - Configuration

  private var configurationTab: some View {
    VStack(alignment: .leading, spacing: 20) {
      section("Availability") {
        ChiefBooleanRow(
          title: "Agent active",
          detail: "Handles work and replies in this workspace",
          isOn: config.enabled
        ) {
          config.enabled.toggle()
          persist()
        }
      }

      section("Deployment") {
        NavigationLink {
          AgentDeploymentView(agent: agent, config: config)
        } label: {
          HStack(spacing: 12) {
            Image(systemName: "iphone.gen3")
              .font(.system(size: 18, weight: .medium))
              .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
              Text("This iPhone")
                .font(.system(size: 15, weight: .medium))
              Text("One dedicated cell · isolated storage and identity")
                .font(.system(size: 12))
                .foregroundStyle(ChiefTheme.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(ChiefTheme.tertiary)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }

      section("Approval") {
        Picker("Approval mode", selection: Binding(
          get: { config.approvals },
          set: { config.approvals = $0; persist() }
        )) {
          Text("Automatic").tag("auto")
          Text("Ask me").tag("ask")
        }
        .pickerStyle(.segmented)
      }

      section("Capabilities") {
        ForEach(AgentConfig.allCapabilities, id: \.self) { capability in
          ChiefBooleanRow(
            title: displayName(capability),
            isOn: config.capabilities.contains(capability)
          ) {
            toggle(\.capabilities, value: capability)
          }
        }
      }

      section("Connected services") {
        ForEach(AgentConfig.allIntegrations, id: \.self) { integration in
          ChiefBooleanRow(
            title: integration.replacingOccurrences(of: "-", with: " ").capitalized,
            isOn: config.integrations.contains(integration)
          ) {
            toggleSet(\.integrations, value: integration)
          }
        }
      }
    }
  }

  // MARK: - Channels

  private var channelsTab: some View {
    VStack(alignment: .leading, spacing: 20) {
      if !membershipsLoaded {
        ProgressView().frame(maxWidth: .infinity, alignment: .center)
      } else {
        Text("Channels and direct messages this agent is part of.")
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
        if channelRows.isEmpty {
          Text("No conversations yet")
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.tertiary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 20)
        } else {
          ForEach(channelRows) { row in
            HStack(spacing: 12) {
              Image(systemName: row.conversation.kind == .direct ? "person.crop.circle" : "number")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(ChiefTheme.secondary)
                .frame(width: 34, height: 34)
              VStack(alignment: .leading, spacing: 2) {
                Text(row.conversation.name).font(.system(size: 15, weight: .medium))
                Text(row.conversation.kind == .direct ? "Direct message" : (row.conversation.isPrivate ? "Private channel" : "Channel"))
                  .font(.system(size: 12))
                  .foregroundStyle(ChiefTheme.secondary)
              }
              Spacer()
              ChiefCheckmark(isOn: row.isMember)
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
            .onTapGesture {
              Haptics.medium()
              Task {
                await model.setAgentMembership(
                  conversationID: row.conversation.id,
                  agentID: agent.id,
                  isMember: !row.isMember
                )
                loadChannelRows()
              }
            }
          }
        }
      }
    }
  }

  // MARK: - Permissions

  private var permissionsTab: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text("Tool grants for this agent. Permissions are enforced by the runtime when the agent calls a tool.")
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
      ForEach(AgentConfig.allToolPermissions, id: \.self) { permission in
        ChiefBooleanRow(
          title: displayName(permission),
          detail: permissionDetails(permission),
          isOn: config.toolPermissions.contains(permission)
        ) {
          setPermission(permission, !config.toolPermissions.contains(permission))
          }
      }
    }
  }

  // MARK: - Helpers

  private func loadChannelRows() {
    Task {
      let conversations = model.workspace?.conversations ?? []
      let memberships = await model.allChannelMemberships()
      let memberConversationIds = Set(
        memberships
          .filter { $0.kind == "agent" && $0.principalId == agent.id }
          .map(\.conversationId)
      )
      channelRows = conversations.map { conversation in
        AgentChannelRow(
          conversation: conversation,
          isMember: memberConversationIds.contains(conversation.id)
        )
      }
      membershipsLoaded = true
    }
  }

  private func setPermission(_ permission: String, _ value: Bool) {
    if value { config.toolPermissions.insert(permission) }
    else { config.toolPermissions.remove(permission) }
    persist()
  }

  private func toggle(_ group: KeyPath<AgentConfig, Set<String>>, value: String) {
    switch group {
    case \.capabilities:
      if config.capabilities.contains(value) { config.capabilities.remove(value) }
      else { config.capabilities.insert(value) }
    case \.integrations:
      if config.integrations.contains(value) { config.integrations.remove(value) }
      else { config.integrations.insert(value) }
    default:
      break
    }
    persist()
  }

  private func toggleSet(_ group: KeyPath<AgentConfig, Set<String>>, value: String) {
    // Same behavior as toggle() without the unused capability label.
    switch group {
    case \.capabilities: toggle(\.capabilities, value: value)
    case \.integrations: toggle(\.integrations, value: value)
    default: break
    }
  }

  @ViewBuilder
  private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title)
        .font(.system(size: 15, weight: .semibold, design: .rounded))
        .foregroundStyle(ChiefTheme.secondary)
      VStack(spacing: 14) { content() }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
  }

  private func persist() {
    let pending = config
    saving = true
    saveFailed = false
    Task {
      let saved = await model.saveAgentConfig(agentID: agent.id, config: pending)
      saving = false
      saveFailed = !saved
      if !saved {
        config = await model.refreshAgentConfig(agentID: agent.id)
        Haptics.error()
      }
    }
  }

  private func displayName(_ capability: String) -> String {
    switch capability {
    case "analytics-chart": return "Analytics charts"
    case "prospect-memory": return "Remember prospects"
    case "trend-memory": return "Remember trends"
    case "content-calendar": return "Content calendar"
    case "campaign-memory": return "Campaign memory"
    case "schedule-manager": return "Schedule manager"
    case "workspace": return "Workspace"
    case "channels": return "Channels"
    case "messages": return "Messages"
    case "scheduled-work": return "Scheduled work"
    case "advanced": return "Advanced (code, browser)"
    default: return capability.replacingOccurrences(of: "-", with: " ").capitalized
    }
  }

  private func permissionDetails(_ permission: String) -> String {
    switch permission {
    case "workspace": return "Manage its own identity and membership"
    case "channels": return "Create and manage channels"
    case "messages": return "Post, reply, and react to messages"
    case "scheduled-work": return "Queue future jobs"
    case "advanced": return "Execute code and drive a browser"
    default: return "Grant this tool area to the agent"
    }
  }
}

private struct AgentDeploymentView: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary
  let config: AgentConfig

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        VStack(alignment: .leading, spacing: 6) {
          Text("Runtime")
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .foregroundStyle(ChiefTheme.secondary)
          ChiefCard {
            HStack(spacing: 13) {
              Image(systemName: "iphone.gen3")
                .font(.system(size: 22, weight: .medium))
                .frame(width: 36, height: 36)
              VStack(alignment: .leading, spacing: 3) {
                Text("On this iPhone")
                  .font(.system(size: 16, weight: .semibold))
                Text("Active deployment")
                  .font(.system(size: 12))
                  .foregroundStyle(ChiefTheme.secondary)
              }
              Spacer()
              ChiefCheckmark(isOn: true)
            }
          }
        }

        VStack(alignment: .leading, spacing: 8) {
          Text("Isolation")
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .foregroundStyle(ChiefTheme.secondary)
          Text("\(agent.name) runs in its own keyed cell with its own SQLite database, Keychain identity, mailbox, and job queue. No other agent shares this runtime.")
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.secondary)
            .lineSpacing(3)
          detailRow("Cell", agent.id)
          detailRow("Model", config.model)
          detailRow("Workspace", model.workspace?.name ?? "Unavailable")
        }

        VStack(alignment: .leading, spacing: 8) {
          Text("Hosted deployment")
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .foregroundStyle(ChiefTheme.secondary)
          Text("Cloud deployment isn't enabled in this build yet. When it is, this agent will move as one dedicated cell rather than sharing a runtime with other agents.")
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.secondary)
            .lineSpacing(3)
        }
      }
      .padding(ChiefTheme.pagePadding)
    }
    .background(ChiefTheme.background)
    .navigationTitle("Deployment")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func detailRow(_ title: String, _ value: String) -> some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title).foregroundStyle(ChiefTheme.tertiary)
      Spacer()
      Text(value).multilineTextAlignment(.trailing)
    }
    .font(.system(size: 13))
    .padding(.vertical, 4)
  }
}
