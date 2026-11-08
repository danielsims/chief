import SwiftUI

/// Desktop's Agents page: every agent on the team, its role and whether it's
/// active. A tap opens the agent's settings.
struct AgentsView: View {
  @Environment(AppModel.self) private var model
  @State private var search = ""

  private var agents: [AgentSummary] { model.workspace?.agents ?? [] }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Agents")
          .font(.system(size: 26, weight: .regular, design: .rounded))
          .tracking(-0.6)
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 16)
      if !agents.isEmpty {
        ChiefSearchField(prompt: "Search agents", text: $search)
      }
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if agents.isEmpty {
            ContentUnavailableView(
              "No agents yet", systemImage: "person.2",
              description: Text("Agents you add on desktop appear here."))
            .foregroundStyle(ChiefTheme.secondary)
          } else if filtered.isEmpty {
            ContentUnavailableView.search(text: search)
              .foregroundStyle(ChiefTheme.secondary)
          } else {
            ForEach(filtered) { agent in
              NavigationLink {
                AgentDetailView(agent: agent)
              } label: {
                AgentRow(agent: agent, enabled: model.agentConfig(agentID: agent.id).enabled)
              }
              .buttonStyle(.plain)
              .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
              .accessibilityIdentifier("agent-row-\(agent.id)")
            }
          }
        }
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.bottom, ChiefTheme.pagePadding)
      }
    }
    .background(ChiefTheme.background)
  }

  private var filtered: [AgentSummary] {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return agents }
    return agents.filter { agent in
      agent.name.localizedCaseInsensitiveContains(query)
        || agent.role.localizedCaseInsensitiveContains(query)
        || agent.subagents.contains { $0.name.localizedCaseInsensitiveContains(query) }
    }
  }
}

/// One agent: who it is, its role and subagents, and whether it's on.
private struct AgentRow: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary
  let enabled: Bool

  var body: some View {
    HStack(spacing: 12) {
      AgentMark(name: agent.name, id: agent.id, size: 40, working: model.isAgentWorking(agentID: agent.id))
      VStack(alignment: .leading, spacing: 3) {
        Text(agent.name)
          .font(.system(size: 15, weight: .medium))
        Text([agent.role, agent.subagentCountLabel].compactMap { $0 }.joined(separator: " · "))
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
      }
      .lineLimit(1)
      Spacer(minLength: 8)
      HStack(spacing: 6) {
        Circle()
          .fill(enabled ? Color.green : ChiefTheme.tertiary)
          .frame(width: 6, height: 6)
        Text(enabled ? "Active" : "Paused")
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
      }
    }
    .frame(minHeight: 62)
    .contentShape(Rectangle())
  }
}
