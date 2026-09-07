import SwiftUI

private struct AgentChannelRow: Identifiable {
  let conversation: ConversationSummary
  var isMember: Bool
  var id: String { conversation.id }
}

struct AgentChannelsView: View {
  @Environment(AppModel.self) private var model
  let agent: AgentSummary

  @State private var rows: [AgentChannelRow] = []
  @State private var loading = true

  var body: some View {
    SettingsPage {
      VStack(alignment: .leading, spacing: 0) {
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
            .padding(.vertical, 14)
          }
        }
      }
      Text("Choose the channels this agent can join.").font(.system(size: 12)).foregroundStyle(
        ChiefTheme.secondary)
    }
    .navigationTitle("Channels")
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
