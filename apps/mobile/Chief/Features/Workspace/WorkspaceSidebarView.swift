import SwiftUI

/// The Channels conversation group, used on Home.
struct ChannelGroup: View {
  @Environment(AppModel.self) private var model
  @State private var expanded = true

  var body: some View {
    CollapsibleGroup(title: "Channels", count: channels.count, isExpanded: $expanded) {
      ForEach(channels) { conversation in
        ConversationRow(conversation: conversation)
      }
    }
  }

  private var channels: [ConversationSummary] {
    model.workspace?.conversations.filter { $0.kind == .channel } ?? []
  }
}

/// The direct message group, used on the DMs tab.
struct DMsGroup: View {
  @Environment(AppModel.self) private var model
  @State private var expanded = true

  var body: some View {
    CollapsibleGroup(title: "DMs", count: dms.count, isExpanded: $expanded) {
      ForEach(dms) { conversation in
        ConversationRow(conversation: conversation)
      }
    }
  }

  private var dms: [ConversationSummary] {
    model.workspace?.conversations.filter { $0.kind == .direct } ?? []
  }
}

/// The agent roster, used on the Agents tab.
struct AgentsGroup: View {
  @Environment(AppModel.self) private var model
  @State private var expanded = true

  var body: some View {
    CollapsibleGroup(
      title: "Agents",
      count: model.workspace?.agents.count ?? 0,
      isExpanded: $expanded
    ) {
      ForEach(model.workspace?.agents ?? []) { agent in
        AgentRow(agent: agent)
      }
    }
  }
}

private struct CollapsibleGroup<Content: View>: View {
  let title: String
  let count: Int
  @Binding var isExpanded: Bool
  @ViewBuilder let content: () -> Content

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Button {
        withAnimation(.easeInOut(duration: 0.18)) { isExpanded.toggle() }
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "chevron.down")
            .font(.system(size: 10, weight: .semibold))
            .rotationEffect(.degrees(isExpanded ? 0 : -90))
          Text(title).font(.system(size: 13, weight: .semibold))
          Text("\(count)")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(ChiefTheme.tertiary)
          Spacer()
        }
        .foregroundStyle(ChiefTheme.secondary)
        .contentShape(Rectangle())
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.vertical, 6)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("\(title), \(count)")

      if isExpanded {
        VStack(spacing: 2) { content() }
          .padding(.horizontal, ChiefTheme.pagePadding)
          .transition(.opacity)
      }
    }
  }
}

private struct AgentRow: View {
  let agent: AgentSummary

  var body: some View {
    HStack(spacing: 12) {
      AgentMark(name: agent.name, size: 34, working: agent.status == .working)
      VStack(alignment: .leading, spacing: 2) {
        Text(agent.name).font(.system(size: 15, weight: .medium))
        Text(agent.status == .working ? "Working now" : agent.role)
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
      }
      Spacer()
      if agent.status == .needsYou {
        Circle().fill(ChiefTheme.accent).frame(width: 7, height: 7)
      }
    }
    .padding(.vertical, 5)
  }
}

private struct ConversationRow: View {
    let conversation: ConversationSummary

    var body: some View {
        NavigationLink(value: conversation.id) {
            HStack(spacing: 12) {
                if conversation.kind == .direct {
                    AgentMark(name: conversation.name, size: 34)
                } else {
                    Image(systemName: conversation.isPrivate ? "lock" : "number")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(ChiefTheme.secondary)
                        .frame(width: 34, height: 34)
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text(conversation.name)
                            .font(.system(size: 15, weight: conversation.unreadCount > 0 ? .semibold : .regular))
                        if conversation.requiresAttention {
                            Text("Requires attention")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(ChiefTheme.accent)
                        }
                    }
                    if let preview = conversation.lastMessage {
                        Text(preview).font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if conversation.unreadCount > 0 {
                    Text("\(conversation.unreadCount)")
                        .font(.system(size: 11, weight: .semibold))
                        .frame(minWidth: 20, minHeight: 20)
                        .background(.white, in: Capsule())
                        .foregroundStyle(.black)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 5)
    }
}
