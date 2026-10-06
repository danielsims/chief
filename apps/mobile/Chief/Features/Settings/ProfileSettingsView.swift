import SwiftUI

struct ProfileSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var email: String?
  @State private var confirmingDelete = false
  @State private var deletingAccount = false
  @State private var accountError: String?

  var body: some View {
    SettingsPage(
      intro:
        "Your name and email come from your sign-in provider. Your profile image can be changed here."
    ) {
      HStack(spacing: 16) {
        ProfilePhotoPicker(imageURL: user?.imageURL, name: user?.name ?? "") { data in
          try await model.saveProfileImage(data)
        }
        VStack(alignment: .leading, spacing: 4) {
          Text(user?.name ?? "Account")
            .font(.system(size: 22, weight: .regular, design: .rounded))
            .lineLimit(1)
          if let email {
            Text(email).font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
              .lineLimit(1)
          }
        }
      }

      SettingsSection(
        title: "Account", footer: "Signing out keeps local data on this iPhone."
      ) {
        SettingsActionRow(title: "Sign out", icon: "rectangle.portrait.and.arrow.right") {
          Haptics.heavy()
          Task { await model.signOut(of: model.appConfiguration.relayURL) }
        }
        SettingsActionRow(
          title: deletingAccount ? "Deleting account…" : "Delete account",
          icon: "trash", role: .destructive, isWorking: deletingAccount
        ) {
          confirmingDelete = true
        }
        .accessibilityIdentifier("delete-account")
        if let accountError {
          SettingsNote(text: accountError, tone: .failure)
            .accessibilityIdentifier("delete-account-error")
        }
      }
    }
    .navigationTitle("Profile")
    .task(id: model.workspace?.id) { await loadEmail() }
    .alert("Delete account?", isPresented: $confirmingDelete) {
      Button("Cancel", role: .cancel) {}
      Button("Delete account", role: .destructive) {
        Task { await deleteAccount() }
      }
    } message: {
      Text(
        "This permanently deletes your Chief account on this relay, including workspaces you own, and signs you out."
      )
    }
  }

  private var user: ChiefUser? {
    model.session.map { model.person(userID: $0.user.id) }
  }

  /// The session carries no email, so read it from the workspace roster.
  private func loadEmail() async {
    guard let workspaceID = model.workspace?.id, let userID = model.session?.user.id,
      let members = try? await model.relay.workspaceMembers(workspaceID: workspaceID)
    else { return }
    email = members.first { $0.isPerson && $0.principalId == userID }?.email
  }

  private func deleteAccount() async {
    guard !deletingAccount else { return }
    deletingAccount = true
    accountError = nil
    defer { deletingAccount = false }
    do {
      try await model.deleteAccount()
    } catch {
      accountError =
        error.localizedDescription.isEmpty
        ? "Chief could not delete this account. Try again."
        : error.localizedDescription
      Haptics.error()
    }
  }
}
