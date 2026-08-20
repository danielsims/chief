import SwiftUI

struct WorkspaceQuickCreateMenu: View {
  let onInvite: () -> Void
  let onChannel: () -> Void
  let onMessage: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      action(
        icon: "person.badge.plus",
        title: "Invite",
        detail: "Add people to this workspace",
        enabled: false,
        action: onInvite
      )
      Divider().overlay(ChiefTheme.line)
      action(
        icon: "number",
        title: "Channel",
        detail: "Organise a team or project",
        action: onChannel
      )
      Button {
        Haptics.heavy()
        onMessage()
      } label: {
        Label("Message", systemImage: "square.and.pencil")
          .font(.system(size: 17, weight: .semibold, design: .rounded))
          .foregroundStyle(.white)
          .frame(maxWidth: .infinity)
          .frame(height: 52)
          .background(Color.black.opacity(0.34), in: Capsule())
          .overlay { Capsule().stroke(ChiefTheme.line, lineWidth: 0.5) }
      }
      .buttonStyle(.plain)
      .padding(12)
    }
    .frame(width: 330)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .stroke(Color.white.opacity(0.10), lineWidth: 0.5)
    }
    .shadow(color: .black.opacity(0.30), radius: 22, y: 10)
    .accessibilityElement(children: .contain)
  }

  private func action(
    icon: String,
    title: String,
    detail: String,
    enabled: Bool = true,
    action: @escaping () -> Void
  ) -> some View {
    Button {
      Haptics.medium()
      action()
    } label: {
      HStack(spacing: 14) {
        Image(systemName: icon)
          .font(.system(size: 19, weight: .regular))
          .frame(width: 40, height: 40)
          .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        VStack(alignment: .leading, spacing: 2) {
          Text(title)
            .font(.system(size: 17, weight: .semibold, design: .rounded))
          Text(enabled ? detail : "Available when team identity is connected")
            .font(.system(size: 12, design: .rounded))
            .foregroundStyle(ChiefTheme.secondary)
        }
        Spacer(minLength: 0)
      }
      .foregroundStyle(enabled ? Color.white : ChiefTheme.tertiary)
      .padding(.horizontal, 16)
      .frame(minHeight: 66)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
  }
}

struct NewMessageView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let onStarted: (String) -> Void

  @State private var query = ""
  @State private var recipients: [DirectMessageRecipient] = []
  @State private var loading = true
  @State private var startingID: String?
  @State private var failed = false
  @FocusState private var searchFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
      header
      search
      Divider().overlay(ChiefTheme.line)
      recipientList
    }
    .background(ChiefTheme.background.ignoresSafeArea())
    .task {
      recipients = await model.directMessageRecipients()
      loading = false
      searchFocused = true
    }
  }

  private var header: some View {
    ZStack {
      Text("New message")
        .font(.system(size: 19, weight: .semibold, design: .rounded))
      HStack {
        Button {
          Haptics.medium()
          dismiss()
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 16, weight: .semibold))
            .frame(width: 44, height: 44)
            .background(ChiefTheme.elevated, in: Circle())
            .overlay { Circle().stroke(ChiefTheme.line, lineWidth: 0.5) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close")
        Spacer()
      }
    }
    .padding(.horizontal, ChiefTheme.pagePadding)
    .padding(.top, 10)
    .frame(height: 68)
  }

  private var search: some View {
    HStack(spacing: 10) {
      Text("To:")
        .foregroundStyle(ChiefTheme.secondary)
      TextField("Search people and agents", text: $query)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .focused($searchFocused)
        .submitLabel(.done)
      if !query.isEmpty {
        Button { query = "" } label: {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(ChiefTheme.tertiary)
        }
        .buttonStyle(.plain)
      }
    }
    .font(.system(size: 17))
    .padding(.horizontal, ChiefTheme.pagePadding)
    .frame(height: 62)
  }

  @ViewBuilder private var recipientList: some View {
    if loading {
      Spacer()
      ProgressView().tint(.white)
      Spacer()
    } else if filteredRecipients.isEmpty {
      ContentUnavailableView(
        query.isEmpty ? "No teammates yet" : "No matches",
        systemImage: "person.2",
        description: Text(
          query.isEmpty
            ? "Agents appear here as soon as their isolated cells join the workspace."
            : "Try another name."
        )
      )
      .foregroundStyle(.white)
    } else {
      ScrollView {
        LazyVStack(spacing: 0) {
          ForEach(filteredRecipients) { recipient in
            recipientRow(recipient)
          }
        }
        .padding(.vertical, 8)
      }
    }
  }

  private func recipientRow(_ recipient: DirectMessageRecipient) -> some View {
    Button {
      guard startingID == nil else { return }
      Haptics.heavy()
      startingID = recipient.id
      failed = false
      Task {
        if let conversationID = await model.startDirectMessage(with: recipient) {
          onStarted(conversationID)
          dismiss()
        } else {
          failed = true
          startingID = nil
        }
      }
    } label: {
      HStack(spacing: 13) {
        if recipient.isAgent {
          AgentMark(name: recipient.principalID, size: 40)
        } else {
          Image(systemName: "person.fill")
            .font(.system(size: 18))
            .foregroundStyle(.white)
            .frame(width: 40, height: 40)
            .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 12))
        }
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 7) {
            Text(recipient.name)
              .font(.system(size: 17, weight: .semibold))
            if recipient.isAgent {
              Text("Agent")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(ChiefTheme.secondary)
                .padding(.horizontal, 6)
                .frame(height: 20)
                .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 5))
            }
          }
          Text(recipient.isAgent ? "Runs in its own isolated cell" : recipient.role.capitalized)
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
        }
        Spacer()
        if startingID == recipient.id {
          ProgressView().tint(.white)
        } else {
          Circle()
            .stroke(ChiefTheme.secondary.opacity(0.65), lineWidth: 1.5)
            .frame(width: 24, height: 24)
        }
      }
      .foregroundStyle(.white)
      .padding(.horizontal, ChiefTheme.pagePadding)
      .frame(minHeight: 68)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .alert("Couldn’t start this message", isPresented: $failed) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("Chief couldn’t create the direct conversation on the relay. Try again.")
    }
  }

  private var filteredRecipients: [DirectMessageRecipient] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return recipients }
    return recipients.filter {
      $0.name.localizedCaseInsensitiveContains(trimmed)
        || $0.principalID.localizedCaseInsensitiveContains(trimmed)
    }
  }
}
