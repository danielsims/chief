import SwiftUI

/// A member's profile, laid out like the desktop profile panel: photo, name
/// and role, a Message action, contact details and shared channels. Your own
/// profile looks the same, minus Message; editing lives in Settings.
struct PersonProfileView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let userID: String
  let name: String

  @State private var channels: [ConversationSummary] = []
  @State private var messaging = false
  @State private var messageFailed = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        identity
          .padding(.bottom, 24)

        if let email = member?.email, !email.isEmpty {
          section("Contact information") {
            HStack(spacing: 12) {
              Image(systemName: "envelope")
                .font(.system(size: 15))
                .foregroundStyle(ChiefTheme.secondary)
                .frame(width: 36, height: 36)
                .background(
                  ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
              VStack(alignment: .leading, spacing: 2) {
                Text("Email address")
                  .font(.system(size: 11, weight: .medium))
                  .foregroundStyle(ChiefTheme.secondary)
                if let url = URL(string: "mailto:\(email)") {
                  Link(email, destination: url)
                    .font(.system(size: 14))
                    .foregroundStyle(Color(red: 0.05, green: 0.65, blue: 0.91))
                    .lineLimit(1)
                }
              }
            }
          }
        }

        if !channels.isEmpty {
          section("Channels") {
            VStack(spacing: 0) {
              ForEach(channels) { channel in
                Button {
                  Haptics.selection()
                  open(channel.id)
                } label: {
                  HStack(spacing: 10) {
                    Image(systemName: "number")
                      .font(.system(size: 13))
                      .foregroundStyle(ChiefTheme.secondary)
                    Text(channel.name)
                      .font(.system(size: 15))
                      .foregroundStyle(ChiefTheme.accent)
                      .lineLimit(1)
                    Spacer(minLength: 0)
                  }
                  .frame(minHeight: 40)
                  .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
              }
            }
          }
        }
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 16)
      .padding(.bottom, 104)
    }
    .background(ChiefTheme.background)
    .navigationTitle("Profile")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: userID) { await loadChannels() }
    .alert("Couldn’t open this conversation", isPresented: $messageFailed) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("Chief couldn’t start the direct message. Try again.")
    }
    .accessibilityIdentifier("person-profile-\(userID)")
  }

  private var identity: some View {
    VStack(alignment: .leading, spacing: 0) {
      photo
      Text(displayName)
        .font(.system(size: 22, weight: .semibold))
        .tracking(-0.6)
        .lineLimit(1)
        .padding(.top, 16)
      Text((member?.role ?? "member").capitalized)
        .font(.system(size: 14))
        .foregroundStyle(ChiefTheme.secondary)
        .padding(.top, 4)
      if !isSelf { messageButton }
    }
  }

  private var isSelf: Bool { userID == model.session?.user.id }

  private var messageButton: some View {
    Button(action: message) {
      Group {
        if messaging {
          ChiefSpinner().controlSize(.small)
        } else {
          Label("Message", systemImage: "bubble.left")
        }
      }
      .font(.system(size: 15, weight: .medium))
      .foregroundStyle(ChiefTheme.accent)
      .frame(maxWidth: .infinity, minHeight: 42)
      .overlay {
        RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(ChiefTheme.line)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(messaging)
    .padding(.top, 18)
  }

  private var photo: some View {
    let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
    // A width-filling square; the photo fills it and is cropped to it.
    return Color.clear
      .aspectRatio(1, contentMode: .fit)
      .frame(maxWidth: .infinity)
      .overlay {
        AsyncImage(url: person.imageURL) { image in
          image.resizable().scaledToFill()
        } placeholder: {
          shape.fill(ChiefTheme.primary).overlay {
            Text(initials)
              .font(.system(size: 52, weight: .semibold))
              .tracking(-1.5)
              .foregroundStyle(ChiefTheme.onPrimary)
          }
        }
      }
      .clipShape(shape)
      .accessibilityHidden(true)
  }

  private func section<Content: View>(
    _ title: String, @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.system(size: 15, weight: .semibold))
      content()
    }
    .padding(.vertical, 20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .top) {
      Rectangle().fill(ChiefTheme.line).frame(height: 1)
    }
  }

  private var member: WorkspaceMember? { model.workspacePeople[userID] }

  private var person: ChiefUser { model.person(userID: userID, fallbackName: name) }

  private var displayName: String {
    let trimmed = person.name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Member" : trimmed
  }

  private var initials: String {
    let words = displayName.split(separator: " ")
    return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
  }

  /// Opens the existing DM with this person, or starts one.
  private func message() {
    Haptics.medium()
    if let existing = model.workspace?.conversations.first(where: {
      $0.kind == .direct && $0.directUserID == userID
    }) {
      open(existing.id)
      return
    }
    messaging = true
    Task {
      let conversationID = await model.startDirectMessage(
        with: DirectMessageRecipient(
          kind: "user", principalID: userID, name: displayName, role: member?.role ?? "member"))
      messaging = false
      if let conversationID {
        open(conversationID)
      } else {
        messageFailed = true
        Haptics.error()
      }
    }
  }

  /// Leaves the profile first: it is pushed over the conversation it was
  /// opened from, which may be the one being opened.
  private func open(_ conversationID: String) {
    dismiss()
    model.selectedConversationID = conversationID
  }

  private func loadChannels() async {
    let joined = Set(
      await model.allChannelMemberships()
        .filter { $0.kind == "user" && $0.principalId == userID }
        .map(\.conversationId))
    channels = (model.workspace?.conversations ?? []).filter {
      $0.kind == .channel && !$0.archived && joined.contains($0.id)
    }
  }
}
