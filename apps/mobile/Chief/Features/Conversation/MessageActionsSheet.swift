import SwiftUI
import UIKit

struct MessageActionsSheet: View {
  @Environment(\.dismiss) private var dismiss

  let message: ConversationMessage
  let canManage: Bool
  let onReact: (String) -> Void
  let onMoreReactions: () -> Void
  let onReply: () -> Void
  let onEdit: () -> Void
  let onDelete: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      ChiefSheetHeader(title: "Message")
      reactionBar
      actionList
    }
    .padding(.bottom, 12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .chiefSheet([.height(canManage && !message.deleted ? 390 : 286)])
  }

  private var reactionBar: some View {
    HStack(spacing: 0) {
      ForEach(ChiefEmojiCatalog.quickReactions, id: \.self) { emoji in
        reactionButton(emoji)
      }
      Button {
        Haptics.medium()
        dismissThen(onMoreReactions)
      } label: {
        Image(systemName: "plus")
          .font(.system(size: 18, weight: .semibold))
          .foregroundStyle(ChiefSheetPalette.secondary)
          .frame(width: 44, height: 44)
          .background(ChiefSheetPalette.surface, in: Circle())
      }
      .buttonStyle(.plain)
      .frame(maxWidth: .infinity)
      .accessibilityLabel("More reactions")
    }
    .padding(.horizontal, ChiefTheme.pagePadding)
    .padding(.bottom, 12)
  }

  private var actionList: some View {
    VStack(spacing: 0) {
      MessageActionRow(title: "Reply in thread", systemImage: "arrowshape.turn.up.left") {
        Haptics.heavy()
        dismissThen(onReply)
      }
      MessageActionRow(title: "Copy text", systemImage: "doc.on.doc") {
        Haptics.medium()
        UIPasteboard.general.string = message.body
        dismiss()
      }
      if canManage && !message.deleted {
        MessageActionRow(title: "Edit message", systemImage: "pencil") {
          Haptics.medium()
          dismissThen(onEdit)
        }
        MessageActionRow(
          title: "Delete message",
          systemImage: "trash",
          role: .destructive
        ) {
          Haptics.medium()
          dismissThen(onDelete)
        }
      }
    }
    .padding(.horizontal, ChiefTheme.pagePadding)
  }

  private func reactionButton(_ emoji: String) -> some View {
    Button {
      Haptics.heavy()
      dismissThen { onReact(emoji) }
    } label: {
      Text(emoji)
        .font(.system(size: 20))
        .frame(width: 44, height: 44)
        .background(ChiefSheetPalette.surface, in: Circle())
    }
    .buttonStyle(.plain)
    .frame(maxWidth: .infinity)
    .accessibilityLabel("React with \(emoji)")
  }

  private func dismissThen(_ action: @escaping () -> Void) {
    dismiss()
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(180))
      action()
    }
  }
}

private struct MessageActionRow: View {
  let title: String
  let systemImage: String
  var role: ButtonRole?
  let action: () -> Void

  var body: some View {
    Button(role: role, action: action) {
      HStack(spacing: 14) {
        Image(systemName: systemImage)
          .font(.system(size: 16, weight: .medium))
          .frame(width: 22)
        Text(title)
          .font(.system(size: 16, weight: .medium))
        Spacer(minLength: 0)
      }
      .foregroundStyle(role == .destructive ? Color.red : ChiefSheetPalette.primary)
      .frame(maxWidth: .infinity)
      .frame(height: 52)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

struct EmojiPickerSheet: View {
  @Environment(\.dismiss) private var dismiss
  let onSelect: (String) -> Void

  var body: some View {
    VStack(spacing: 0) {
      ChiefSheetHeader(title: "Pick a reaction")

      ScrollView {
        LazyVGrid(
          columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 6),
          spacing: 14
        ) {
          ForEach(ChiefEmojiCatalog.all, id: \.self) { emoji in
            Button {
              Haptics.heavy()
              onSelect(emoji)
              dismiss()
            } label: {
              Text(emoji)
                .font(.system(size: 28))
                .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("React with \(emoji)")
          }
        }
        .padding(ChiefTheme.pagePadding)
      }
    }
    .chiefSheet([.medium, .large])
  }
}

struct EditMessageSheet: View {
  @Environment(\.dismiss) private var dismiss
  @FocusState private var isFocused: Bool

  let message: ConversationMessage
  let onSave: (String) -> Void
  @State private var text: String

  init(message: ConversationMessage, onSave: @escaping (String) -> Void) {
    self.message = message
    self.onSave = onSave
    _text = State(initialValue: message.body)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(title: "Edit message", doneTitle: "Cancel")
      VStack(alignment: .leading, spacing: 14) {
        TextField("Message", text: $text, axis: .vertical)
          .lineLimit(1...6)
          .padding(12)
          .background(ChiefSheetPalette.surface, in: RoundedRectangle(cornerRadius: 12))
          .overlay { RoundedRectangle(cornerRadius: 12).stroke(ChiefSheetPalette.separator) }
          .focused($isFocused)
        Button("Save", action: save)
          .font(.system(size: 16, weight: .semibold, design: .rounded))
          .foregroundStyle(Color(uiColor: .systemBackground))
          .frame(maxWidth: .infinity)
          .frame(height: 46)
          .background(Color(uiColor: .label), in: RoundedRectangle(cornerRadius: 13))
          .buttonStyle(.plain)
          .disabled(trimmedText.isEmpty || trimmedText == message.body)
      }
      .padding(.horizontal, 24)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .chiefSheet([.height(250)])
    .onAppear { isFocused = true }
  }

  private var trimmedText: String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func save() {
    guard !trimmedText.isEmpty, trimmedText != message.body else { return }
    Haptics.medium()
    onSave(trimmedText)
    dismiss()
  }
}
