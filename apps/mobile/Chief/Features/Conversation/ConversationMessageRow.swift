import SwiftUI

struct ConversationMessageRow: View {
  @Environment(AppModel.self) private var model

  let message: ConversationMessage
  var showsAuthor = true
  var showsThreadSummary = true
  var allowsActions = true
  var onReply: (ConversationMessage) -> Void = { _ in }
  var onEdit: (ConversationMessage) -> Void = { _ in }

  @State private var activeSheet: MessageSheet?
  @State private var showsDeleteConfirmation = false
  @State private var openProfile: MessageProfile?

  @ViewBuilder
  var body: some View {
    if let action = channelAction {
      ChannelMembershipRow(
        action: action,
        createdAt: message.createdAt,
        fallbackBody: message.body
      )
    } else if let reference = ScheduledRunReference(message: message) {
      ScheduledRunMessageCard(reference: reference, replyCount: replyCount, openThread: showsThreadSummary ? { onReply(message) } : nil)
    } else {
      ordinaryMessage
    }
  }

  private var ordinaryMessage: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .top, spacing: 11) {
        avatar
        VStack(alignment: .leading, spacing: 7) {
          if showsAuthor { authorHeader }
          messageContent
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      if !message.reactions.isEmpty {
        reactionPills
      }
      if showsThreadSummary, replyCount > 0 {
        threadSummary
      }
    }
    .padding(.vertical, 2)
    .contentShape(Rectangle())
    .transition(.opacity.combined(with: .offset(y: 5)))
    .onLongPressGesture(minimumDuration: 0.4) {
      guard allowsActions else { return }
      Haptics.heavy()
      activeSheet = .actions
    }
    .sheet(item: $activeSheet, content: sheet)
    .navigationDestination(item: $openProfile) { destination in
      switch destination {
      case .agent(let agentID):
        let card = model.workspace?.agentCard(for: agentID) ?? .chiefFallback(for: agentID)
        AgentDetailView(agent: card.agent, highlightedSubagentID: card.subagentID)
      case .person(let userID, let name):
        PersonProfileView(userID: userID, name: name)
      }
    }
    .alert("Delete this message?", isPresented: $showsDeleteConfirmation) {
      Button("Cancel", role: .cancel) {}
      Button("Delete", role: .destructive, action: deleteMessage)
    } message: {
      Text("This cannot be undone.")
    }
  }

  private var channelAction: MessageComponent? {
    message.components.first { $0.kind == "channel-action" }
  }

  @ViewBuilder
  private var avatar: some View {
    if showsAuthor {
      Button(action: openAuthorProfile) {
        switch message.author {
        case .agent(_, let name): AgentMark(name: name, size: 34)
        case .user(let id, let name):
          UserAvatar(user: model.person(userID: id, fallbackName: name), size: 34, rounded: true)
        case .guest(let guest): GuestAvatar(guest: guest, size: 34)
        case .system: AgentMark(name: "Chief", size: 34)
        }
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Open \(authorName) profile")
    } else {
      Color.clear.frame(width: 34, height: 34)
    }
  }

  private var authorHeader: some View {
    HStack(spacing: 7) {
      Text(authorName)
        .font(.system(size: 14, weight: .semibold))
      if case .guest(let guest) = message.author {
        Text(guest.label)
          .font(.system(size: 11))
          .foregroundStyle(ChiefTheme.tertiary)
          .lineLimit(1)
      }
      Text(message.createdAt, style: .time)
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.tertiary)
      if message.edited {
        Text("(edited)")
          .font(.system(size: 11))
          .italic()
          .foregroundStyle(ChiefTheme.tertiary)
      }
    }
  }

  @ViewBuilder
  private var messageContent: some View {
    if message.deleted {
      Text("This message was deleted.")
        .font(.system(size: 14))
        .italic()
        .foregroundStyle(ChiefTheme.tertiary)
    } else {
      MessageBody(text: message.body, channelNames: channelNames)
      MessageComponentList(message: message)
    }
  }

  private var reactionPills: some View {
    HStack(spacing: 6) {
      ForEach(message.reactions, id: \.emoji) { reaction in
        Button {
          Haptics.medium()
          react(with: reaction.emoji, add: !hasReacted(to: reaction))
        } label: {
          Text("\(reaction.emoji) \(reaction.pubkeys.count)")
            .font(.system(size: 13))
            .foregroundStyle(hasReacted(to: reaction) ? ChiefTheme.accent : ChiefTheme.secondary)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(
              hasReacted(to: reaction) ? ChiefTheme.accent.opacity(0.18) : ChiefTheme.elevated,
              in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .disabled(!allowsActions)
        .accessibilityLabel("\(reaction.emoji), \(reaction.pubkeys.count) reactions")
      }
      Spacer(minLength: 0)
    }
    .padding(.leading, 45)
  }

  private var threadSummary: some View {
    Button {
      Haptics.medium()
      model.markThreadRead(
        conversationID: message.conversationID,
        rootMessageID: message.id
      )
      onReply(message)
    } label: {
      HStack(spacing: 9) {
        ThreadParticipantStack(
          participants: threadParticipants,
          replyingAgentID: nil
        )
        Text("\(replyCount) \(replyCount == 1 ? "reply" : "replies")")
          .font(.system(size: 12, weight: .semibold))
        if let lastReply = replies.last {
          Text(RelativeDateTimeFormatter.threadActivity.localizedString(
            for: lastReply.createdAt,
            relativeTo: .now
          ))
          .font(.system(size: 11))
          .foregroundStyle(ChiefTheme.tertiary)
          .lineLimit(1)
        }
        if unreadReplyCount > 0 {
          Text("\(unreadReplyCount) new")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(ChiefTheme.onPrimary)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(ChiefTheme.primary, in: Capsule())
        }
        Spacer(minLength: 0)
        Image(systemName: "chevron.right")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      .foregroundStyle(unreadReplyCount > 0 ? ChiefTheme.accent : ChiefTheme.secondary)
      .padding(.leading, 45)
      .padding(.vertical, 3)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(
      unreadReplyCount > 0
        ? "\(replyCount) replies, \(unreadReplyCount) unread"
        : "\(replyCount) replies"
    )
  }

  private var replies: [ConversationMessage] {
    guard let workspaceID = model.workspace?.id else { return [] }
    return model.conversations.messages(
      workspaceID: workspaceID,
      conversationID: message.conversationID
    ).filter { $0.threadRootID == message.id && $0.isVisibleThreadReply }
  }

  private var replyCount: Int { replies.count }

  private var threadParticipants: [ThreadParticipant] {
    var seen = Set<String>()
    var participants = replies.compactMap { reply -> ThreadParticipant? in
      let participant: ThreadParticipant
      switch reply.author {
      case .agent(let id, let name): participant = .agent(id: id, name: name)
      case .user(let id, let name):
        participant = .user(id: id, name: model.person(userID: id, fallbackName: name).name)
      case .guest(let guest): participant = .user(id: "guest:\(guest.id)", name: guest.name)
      case .system: participant = .agent(id: "chief", name: "Chief")
      }
      return seen.insert(participant.id).inserted ? participant : nil
    }
    return participants
  }

  private var unreadReplyCount: Int {
    model.unreadThreadCount(
      conversationID: message.conversationID,
      rootMessageID: message.id
    )
  }

  @ViewBuilder
  private func sheet(_ sheet: MessageSheet) -> some View {
    switch sheet {
    case .actions:
      MessageActionsSheet(
        message: message,
        canManage: canManage,
        onReact: { emoji in
          activeSheet = nil
          react(with: emoji, add: true)
        },
        onMoreReactions: { transition(to: .emojiPicker) },
        onReply: {
          activeSheet = nil
          onReply(message)
        },
        onEdit: {
          activeSheet = nil
          onEdit(message)
        },
        onDelete: {
          activeSheet = nil
          presentDeleteConfirmation()
        }
      )
    case .emojiPicker:
      EmojiPickerSheet { emoji in
        activeSheet = nil
        react(with: emoji, add: true)
      }
    }
  }

  private var authorName: String {
    switch message.author {
    case .agent(_, let name): name.isEmpty ? "Agent" : name
    case .user: model.authorName(message.author)
    case .guest(let guest): guest.name
    case .system: "Chief"
    }
  }

  private var channelNames: Set<String> {
    Set(model.workspace?.conversations.filter { $0.kind == .channel }.map(\.name) ?? [])
  }

  private func openAuthorProfile() {
    Haptics.medium()
    switch message.author {
    case .agent(let id, _):
      openProfile = .agent(id)
    case .user(let id, _):
      openProfile = .person(userID: id, name: model.authorName(message.author))
    case .guest:
      // Outside agents have no workspace profile to open.
      return
    case .system:
      openProfile = .agent("chief")
    }
  }

  private var canManage: Bool {
    guard let identity = try? NostrKeychainStore().load() else { return false }
    guard case .user(let authorID, _) = message.author else { return false }
    return authorID == identity.publicKeyHex || authorID == model.session?.user.id
  }

  private func hasReacted(to reaction: ConversationMessage.Reaction) -> Bool {
    guard let publicKey = (try? NostrKeychainStore().load())?.publicKeyHex else { return false }
    return reaction.pubkeys.contains(publicKey)
  }

  private func react(with emoji: String, add: Bool) {
    Task {
      await model.react(
        to: message.id,
        conversationID: message.conversationID,
        emoji: emoji,
        add: add
      )
    }
  }

  private func transition(to sheet: MessageSheet) {
    activeSheet = nil
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(220))
      activeSheet = sheet
    }
  }

  private func presentDeleteConfirmation() {
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(220))
      showsDeleteConfirmation = true
    }
  }

  private func deleteMessage() {
    Haptics.error()
    Task {
      await model.deleteMessage(
        messageID: message.id,
        conversationID: message.conversationID
      )
    }
  }
}

private enum MessageProfile: Hashable {
  case agent(String)
  case person(userID: String, name: String)
}

private enum MessageSheet: String, Identifiable {
  case actions
  case emojiPicker

  var id: String { rawValue }
}

/// An outside agent's own picture, its Grok Bot colour, its provider's logo,
/// or its initial, in that order.
private struct GuestAvatar: View {
  let guest: GuestAuthor
  let size: CGFloat

  var body: some View {
    Group {
      if let url = guest.imageURL {
        AsyncImage(url: url) { image in
          image.resizable().scaledToFill()
        } placeholder: {
          fallback
        }
      } else {
        fallback
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.28))
  }

  @ViewBuilder
  private var fallback: some View {
    if let color = guest.markColor {
      RoundedRectangle(cornerRadius: size * 0.36)
        .fill(Self.markColors[color] ?? ChiefTheme.elevated)
        .overlay {
          HStack(spacing: size * 0.16) {
            Capsule().fill(.white).frame(width: size * 0.11, height: size * 0.15)
            Capsule().fill(.white).frame(width: size * 0.11, height: size * 0.15)
          }
        }
    } else if let logo = guest.providerLogoURL {
      AsyncImage(url: logo) { image in
        image.resizable().scaledToFit().padding(size * 0.14)
      } placeholder: {
        initial
      }
      .background(ChiefTheme.elevated)
    } else {
      initial
    }
  }

  private var initial: some View {
    RoundedRectangle(cornerRadius: size * 0.28)
      .fill(ChiefTheme.elevated)
      .overlay {
        Text(guest.name.prefix(1).uppercased())
          .font(.system(size: size * 0.38, weight: .semibold))
          .foregroundStyle(ChiefTheme.secondary)
      }
  }

  private static let markColors: [String: Color] = [
    "black": Color(red: 0.14, green: 0.14, blue: 0.15),
    "brown": Color(red: 0.55, green: 0.37, blue: 0.24),
    "red": Color(red: 0.91, green: 0.28, blue: 0.25),
    "orange": Color(red: 0.94, green: 0.54, blue: 0.14),
    "yellow": Color(red: 0.94, green: 0.71, blue: 0.16),
    "green": Color(red: 0.20, green: 0.76, blue: 0.50),
    "cyan": Color(red: 0.13, green: 0.72, blue: 0.78),
    "blue": Color(red: 0.23, green: 0.51, blue: 0.96),
    "violet": Color(red: 0.55, green: 0.36, blue: 0.96),
    "magenta": Color(red: 0.85, green: 0.27, blue: 0.77),
    "gray": Color(red: 0.61, green: 0.64, blue: 0.69),
  ]
}

