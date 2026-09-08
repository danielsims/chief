import SwiftUI

struct UserProfileView: View {
  @Environment(AppModel.self) private var model
  @State private var ownedWorkspaceID: String?

  var body: some View {
    SettingsPage {
      HStack(spacing: 16) {
        ProfilePhotoPicker(
          imageURL: model.session?.user.imageURL, name: model.session?.user.name ?? ""
        ) { data in
          try await model.saveProfileImage(data)
        }
        VStack(alignment: .leading, spacing: 5) {
          Text(model.session?.user.name ?? "Account")
            .font(.system(size: 22, weight: .regular, design: .rounded))
          Text("Personal account").font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
        }
      }
      .padding(.bottom, 4)

      SettingsSection(title: "Workspace") {
        if let ownedWorkspaceID {
          NavigationLink {
            WorkspaceSettingsView(workspaceID: ownedWorkspaceID)
          } label: {
            SettingsDestination(
              title: model.workspace?.name ?? "Workspace", icon: "building.2",
              detail: "Workspace settings")
          }.buttonStyle(.plain)
        }
        NavigationLink {
          RelayConnectionSettingsView()
        } label: {
          SettingsDestination(title: "Connection", icon: "network")
        }.buttonStyle(.plain)
      }
      SettingsSection(title: "Preferences") {
        NavigationLink {
          NotificationSettingsView()
        } label: {
          SettingsDestination(title: "Notifications", icon: "bell")
        }.buttonStyle(.plain)
      }
      Button("Sign out", role: .destructive) {
        Haptics.heavy()
        Task { await model.signOut(of: model.appConfiguration.relayURL) }
      }
      .font(.system(size: 14))
      .padding(.vertical, 12)
    }
    .task(id: model.workspace?.id) {
      ownedWorkspaceID = nil
      guard let id = model.workspace?.id, let userID = model.session?.user.id else { return }
      if let members = try? await model.relay.workspaceMembers(workspaceID: id),
        members.contains(where: {
          $0.kind == "user" && $0.principalId == userID && $0.role == "owner"
        }),
        model.workspace?.id == id
      {
        ownedWorkspaceID = id
      }
    }
    .navigationTitle("Settings")
  }
}
