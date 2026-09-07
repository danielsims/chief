import SwiftUI

struct AgentTreeRow: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary
  @State private var expanded = true
  private let avatarSize: CGFloat = 32

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 0) {
        NavigationLink(value: agent.id) {
          HStack(spacing: 12) {
            AgentMark(
              name: agent.name, size: avatarSize, working: model.isAgentWorking(agentID: agent.id))
            VStack(alignment: .leading, spacing: 4) {
              Text(agent.name).font(.system(size: 16, weight: .medium)).foregroundStyle(
                ChiefTheme.accent)
              Text(model.isAgentWorking(agentID: agent.id) ? "Working now" : agent.role)
                .font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
            }
            Spacer(minLength: 8)
          }
          .frame(minHeight: 58)
          .contentShape(Rectangle())
        }.buttonStyle(.plain)
          .accessibilityIdentifier("agent-row-\(agent.id)")
        if !agent.subagents.isEmpty {
          Button {
            Haptics.selection()
            withAnimation(.easeInOut(duration: 0.18)) { expanded.toggle() }
          } label: {
            Image(systemName: "chevron.down")
              .font(.system(size: 12, weight: .medium))
              .rotationEffect(.degrees(expanded ? 0 : -90))
              .foregroundStyle(ChiefTheme.secondary)
              .frame(width: 44, height: 44)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityLabel("\(expanded ? "Collapse" : "Expand") \(agent.name) subagents")
          .accessibilityValue(expanded ? "Expanded" : "Collapsed")
        }
      }
      if expanded && !agent.subagents.isEmpty {
        VStack(spacing: 0) {
          ForEach(agent.subagents) { specialist in
            NavigationLink(value: specialist.id) {
              HStack(spacing: 10) {
                AgentMark(
                  name: specialist.name, size: 24,
                  working: model.isAgentWorking(agentID: specialist.id))
                Text(specialist.name).font(.system(size: 14)).foregroundStyle(ChiefTheme.secondary)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 10)).foregroundStyle(
                  ChiefTheme.tertiary)
              }
              .frame(minHeight: 46)
              .contentShape(Rectangle())
            }.buttonStyle(.plain)
              .accessibilityIdentifier("agent-row-\(specialist.id)")
          }
        }
        .padding(.leading, avatarSize + 12)
        .padding(.trailing, 14)
        .overlay(alignment: .leading) {
          Rectangle().fill(ChiefTheme.line).frame(width: 1)
            .frame(width: avatarSize)
            .allowsHitTesting(false)
        }
        .padding(.bottom, 8)
      }
    }
  }
}
