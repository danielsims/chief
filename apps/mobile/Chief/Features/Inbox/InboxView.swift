import SwiftUI

/// Desktop's Inbox: the latest messages from people and agents across every
/// conversation, optionally just the unread ones. A tap opens the message
/// where it was sent, in its thread when it is a reply.
struct InboxView: View {
  @Environment(AppModel.self) private var model
  @State private var unreadOnly = false

  var body: some View {
    let visible = model.inboxMessages.filter { !unreadOnly || $0.unread }
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Inbox")
            .font(.system(size: 26, weight: .regular, design: .rounded))
            .tracking(-0.6)
        }
        Spacer(minLength: 0)
        ChiefModePicker(
          selection: $unreadOnly,
          options: [
            .init(value: false, symbol: "tray", label: "All"),
            .init(value: true, symbol: "envelope.badge", label: "Unread"),
          ])
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 16)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if visible.isEmpty {
            ContentUnavailableView(
              "You’re caught up", systemImage: "tray",
              description: Text("New replies, mentions, and work needing your attention will show up here.")
            )
            .foregroundStyle(ChiefTheme.secondary)
          } else {
            ForEach(visible) { item in
              InboxRow(item: item)
            }
          }
        }
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.bottom, ChiefTheme.pagePadding)
      }
    }
    .background(ChiefTheme.background)
  }
}

private struct InboxRow: View {
  @Environment(AppModel.self) private var model
  let item: InboxMessage

  var body: some View {
    Button(action: open) {
      HStack(alignment: .top, spacing: 12) {
        avatar
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 8) {
            Text(authorName)
              .font(.system(size: 14, weight: .semibold))
              .lineLimit(1)
            Spacer(minLength: 8)
            Text(relativeTime)
              .font(.system(size: 11))
              .foregroundStyle(ChiefTheme.tertiary)
          }
          Text(preview)
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.accent.opacity(0.8))
            .lineLimit(2)
            .multilineTextAlignment(.leading)
          Text(place)
            .font(.system(size: 11))
            .foregroundStyle(ChiefTheme.secondary)
            .lineLimit(1)
            .padding(.top, 2)
        }
        Circle()
          .fill(ChiefTheme.channelAccent)
          .frame(width: 7, height: 7)
          .padding(.top, 6)
          .opacity(item.unread ? 1 : 0)
          .accessibilityHidden(true)
      }
      .padding(.vertical, 12)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .overlay(alignment: .bottom) {
      Rectangle().fill(ChiefTheme.line).frame(height: 0.5)
    }
    .contextMenu {
      Button {
        Haptics.medium()
        model.markInboxMessageRead(item)
      } label: {
        Label(item.unread ? "Mark read" : "Read", systemImage: "checkmark.circle")
      }
      .disabled(!item.unread)
      Button(action: open) {
        Label("Open conversation", systemImage: "bubble.left")
      }
    }
    .accessibilityLabel("\(authorName), \(place)\(item.unread ? ", unread" : ""): \(preview)")
  }

  @ViewBuilder
  private var avatar: some View {
    switch item.message.author {
    case .agent(let id, let name):
      AgentMark(name: name, id: id, size: 34)
    case .user(let id, let name):
      UserAvatar(user: model.person(userID: id, fallbackName: name), size: 34, rounded: true)
    case .guest(let guest):
      GuestAvatar(guest: guest, size: 34)
    case .system:
      AgentMark(name: "Chief", size: 34)
    }
  }

  private var authorName: String {
    switch item.message.author {
    case .agent(_, let name): name
    case .user(let id, let name): model.person(userID: id, fallbackName: name).name
    case .guest(let guest): guest.name
    case .system: "Chief"
    }
  }

  private var preview: String {
    let text = MarkdownMessageParser.plainText(item.message.body)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? "Sent an attachment" : text
  }

  private var place: String {
    item.conversation.kind == .direct ? "Direct message" : "#\(item.conversation.name)"
  }

  /// Desktop's compact age: minutes, then hours, then days.
  private var relativeTime: String {
    let minutes = max(1, Int((Date.now.timeIntervalSince(item.message.createdAt) / 60).rounded()))
    if minutes < 60 { return "\(minutes)m" }
    let hours = Int((Double(minutes) / 60).rounded())
    if hours < 24 { return "\(hours)h" }
    return "\(Int((Double(hours) / 24).rounded()))d"
  }

  private func open() {
    Haptics.medium()
    model.openConversation(
      item.conversation.id, threadRootID: item.message.threadRootID, returningTo: .inbox)
  }
}
