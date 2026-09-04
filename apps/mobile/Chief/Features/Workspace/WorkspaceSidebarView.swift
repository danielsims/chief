import SwiftUI

/// The Channels conversation group, used on Home.
struct ChannelGroup: View {
  @Environment(AppModel.self) private var model
  @State private var expanded = true
  @State private var showNewChannel = false

  var body: some View {
    CollapsibleGroup(title: "Channels", count: channels.count, isExpanded: $expanded) {
      ForEach(channels) { conversation in
        ConversationRow(conversation: conversation)
      }
    }
    .overlay(alignment: .topTrailing) {
      Button {
        Haptics.medium()
        showNewChannel = true
      } label: {
        Image(systemName: "plus")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(ChiefTheme.secondary)
          .frame(width: 28, height: 28)
          .background(ChiefTheme.surface, in: Circle())
          .overlay { Circle().stroke(ChiefTheme.line) }
      }
      .buttonStyle(.plain)
      .offset(y: -2)
      .padding(.trailing, ChiefTheme.pagePadding)
      .accessibilityLabel("New channel")
    }
    .sheet(isPresented: $showNewChannel) {
      NewChannelSheet { name, isPrivate in
        Task { await model.createChannel(name: name, isPrivate: isPrivate) }
      }
    }
  }

  private var channels: [ConversationSummary] {
    model.workspace?.conversations
      .filter {
        $0.kind == .channel && !$0.archived && model.isConversationJoined($0.id)
      } ?? []
  }
}

/// A bottom-sheet form for creating a workspace channel.
struct NewChannelSheet: View {
  @Environment(\.dismiss) private var dismiss
  let onCreate: (String, Bool) -> Void
  @State private var name = ""
  @State private var isPrivate = false
  @FocusState private var focused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(title: "New channel", doneTitle: "Cancel")
      VStack(alignment: .leading, spacing: 18) {
        TextField("channel-name", text: $name)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .padding(.horizontal, 14)
          .frame(height: 48)
          .background(ChiefSheetPalette.surface, in: RoundedRectangle(cornerRadius: 13))
          .overlay { RoundedRectangle(cornerRadius: 13).stroke(ChiefSheetPalette.separator) }
          .focused($focused)
        ChiefBooleanRow(
          title: "Private channel",
          detail: "Only invited members can see it",
          isOn: isPrivate,
          action: { isPrivate.toggle() }
        )
        Button {
          let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
          guard !trimmed.isEmpty else { return }
          Haptics.heavy()
          onCreate(trimmed, isPrivate)
          dismiss()
        } label: {
          Text("Create channel")
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(Color(uiColor: .systemBackground))
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Color(uiColor: .label), in: RoundedRectangle(cornerRadius: 13))
        }
        .buttonStyle(.plain)
        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      .padding(.horizontal, 24)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .chiefSheet([.height(310)])
    .onAppear { focused = true }
  }
}

/// The direct message group, displayed directly beneath Channels on Home.
struct DMsGroup: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [String]
  @State private var expanded = true
  @State private var startingAgentID: String?
  @State private var startFailed = false

  var body: some View {
    CollapsibleGroup(title: "DMs", count: rosterCount, isExpanded: $expanded) {
      ForEach(model.workspace?.agents ?? []) { agent in
        if let conversation = directConversation(for: agent) {
          ConversationRow(conversation: conversation)
        } else {
          agentDirectRow(agent)
        }
      }
      ForEach(unmatchedDirectConversations) { conversation in
        ConversationRow(conversation: conversation)
      }
    }
    .alert("Couldn’t start this message", isPresented: $startFailed) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("Chief couldn’t create the direct conversation on the relay. Try again.")
    }
  }

  private var directConversations: [ConversationSummary] {
    model.workspace?.conversations.filter { $0.kind == .direct } ?? []
  }

  private var unmatchedDirectConversations: [ConversationSummary] {
    directConversations.filter { conversation in
      !(model.workspace?.agents.contains { directConversation(for: $0)?.id == conversation.id }
        ?? false)
    }
  }

  private var rosterCount: Int {
    (model.workspace?.agents.count ?? 0) + unmatchedDirectConversations.count
  }

  private func directConversation(for agent: AgentSummary) -> ConversationSummary? {
    directConversations.first { conversation in
      let normalizedName = conversation.name.lowercased()
      return normalizedName.contains(agent.id.lowercased())
        || normalizedName.contains(agent.name.lowercased())
    }
  }

  private func agentDirectRow(_ agent: AgentSummary) -> some View {
    Button {
      guard startingAgentID == nil else { return }
      Haptics.medium()
      startingAgentID = agent.id
      startFailed = false
      Task {
        let recipient = DirectMessageRecipient(
          kind: "agent",
          principalID: agent.id,
          name: agent.name,
          role: agent.role
        )
        if let conversationID = await model.startDirectMessage(with: recipient) {
          path.append(conversationID)
        } else {
          startFailed = true
        }
        startingAgentID = nil
      }
    } label: {
      HStack(spacing: 9) {
        AgentMark(name: agent.name, size: 24, working: agent.status == .working)
        Text(agent.name)
          .font(.system(size: 14, weight: .regular))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(1)
        Spacer(minLength: 8)
        if startingAgentID == agent.id {
          ProgressView().controlSize(.small).tint(.white)
        }
      }
      .frame(height: 38)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(startingAgentID != nil)
    .accessibilityLabel("Message \(agent.name)")
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
        Haptics.light()
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
    NavigationLink(value: agent.id) {
      HStack(spacing: 12) {
        AgentMark(name: agent.name, size: 34, working: agent.status == .working)
        VStack(alignment: .leading, spacing: 2) {
          Text(agent.name).font(.system(size: 15, weight: .medium))
          Text(agent.subagentCountLabel.map { "\(agent.role) · \($0)" } ?? (agent.status == .working ? "Working now" : agent.role))
            .font(.system(size: 13))
            .foregroundStyle(ChiefTheme.secondary)
        }
        Spacer()
        if agent.status == .needsYou {
          Circle().fill(ChiefTheme.accent).frame(width: 7, height: 7)
        }
        Image(systemName: "chevron.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      .padding(.vertical, 5)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
  }
}

private struct ConversationRow: View {
  @Environment(AppModel.self) private var model
  let conversation: ConversationSummary
  @State private var showMembers = false

  var body: some View {
    NavigationLink(value: conversation.id) {
      HStack(spacing: 9) {
        if conversation.kind == .direct {
          AgentMark(name: conversation.name, size: 24)
        } else {
          Image(systemName: conversation.isPrivate ? "lock" : "number")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(ChiefTheme.secondary)
            .frame(width: 24, height: 24)
        }
        HStack(spacing: 7) {
          Text(conversation.name)
            .font(.system(size: 14, weight: conversation.unreadCount > 0 ? .semibold : .regular))
            .foregroundStyle(
              conversation.unreadCount > 0 ? ChiefTheme.accent : ChiefTheme.secondary
            )
            .strikethrough(conversation.archived, color: ChiefTheme.secondary)
            .lineLimit(1)
          if conversation.requiresAttention {
            Circle()
              .fill(ChiefTheme.accent)
              .frame(width: 6, height: 6)
          }
        }
        Spacer(minLength: 8)
        if conversation.unreadCount > 0 {
          Text(conversation.unreadCount > 99 ? "99+" : "\(conversation.unreadCount)")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(ChiefTheme.accent)
            .padding(.horizontal, 7)
            .frame(minWidth: 20, minHeight: 20)
            .background(Color.white.opacity(0.10), in: Capsule())
        }
      }
      .contentShape(Rectangle())
      .frame(height: 38)
    }
    .buttonStyle(.plain)
    .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
    .contextMenu {
      if conversation.kind == .channel {
        Button {
          Haptics.medium()
          Task { await model.channelMembers(conversationID: conversation.id) }
          showMembers = true
        } label: {
          Label("View members", systemImage: "person.2")
        }
        Button {
          Haptics.medium()
          Task {
            await model.archiveConversation(conversation.id, archived: !conversation.archived)
          }
        } label: {
          Label(
            conversation.archived ? "Unarchive channel" : "Archive channel",
            systemImage: conversation.archived ? "tray.and.arrow.up" : "archivebox"
          )
        }
        if !conversation.archived {
          Button(role: .destructive) {
            Haptics.heavy()
            Task { await model.leaveConversation(conversation.id) }
          } label: {
            Label("Leave channel", systemImage: "rectangle.portrait.and.arrow.right")
          }
        }
      }
    }
    .sheet(isPresented: $showMembers) {
      ChannelMembersSheet(
        conversationID: conversation.id,
        conversationName: conversation.name
      )
      .environment(model)
    }
  }
}

/// A sheet listing a channel's members (users + agents).
struct ChannelMembersSheet: View {
  @Environment(AppModel.self) private var model
  let conversationID: String
  let conversationName: String
  @State private var members: [ChannelMember] = []
  @State private var loading = true

  var body: some View {
    NavigationStack {
      List {
        if loading {
          ProgressView().frame(maxWidth: .infinity, alignment: .center)
        } else if members.isEmpty {
          Text("No members yet")
            .frame(maxWidth: .infinity, alignment: .center)
            .foregroundStyle(ChiefTheme.secondary)
        } else {
          ForEach(members) { member in
            HStack(spacing: 12) {
              if member.kind == "agent" {
                AgentMark(name: member.name ?? member.principalId, size: 32)
              } else {
                Circle().fill(ChiefTheme.elevated).frame(width: 32, height: 32)
                  .overlay {
                    Text((member.name ?? "You").prefix(1)).font(
                      .system(size: 13, weight: .semibold))
                  }
              }
              VStack(alignment: .leading, spacing: 2) {
                Text(member.name ?? member.principalId).font(.system(size: 15, weight: .medium))
                Text(member.role.capitalized).font(.system(size: 12)).foregroundStyle(
                  ChiefTheme.secondary)
              }
              Spacer()
            }
            .padding(.vertical, 3)
          }
        }
      }
      .scrollContentBackground(.hidden)
      .background(ChiefSheetPalette.background)
      .navigationTitle("Members")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .task {
        members = await model.channelMembers(conversationID: conversationID)
        loading = false
      }
    }
    .chiefSheet([.height(440), .large])
  }

  @Environment(\.dismiss) private var dismiss
}
