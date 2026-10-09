import SwiftUI

/// Settings, grouped like the desktop settings sidebar. Agents are configured
/// from their own pages, so the desktop's App group has no counterpart here.
struct SettingsView: View {
  @Environment(AppModel.self) private var model
  @AppStorage(ChiefAppearance.storageKey) private var appearance = ChiefAppearance.system

  var body: some View {
    SettingsPage {
      SettingsSection(title: "Personal") {
        NavigationLink {
          ProfileSettingsView()
        } label: {
          SettingsRow {
            UserAvatar(user: model.session.map { model.person(userID: $0.user.id) }, size: 26, rounded: true)
              .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
              Text("Profile").foregroundStyle(ChiefTheme.accent)
              if let name = model.session?.user.name, !name.isEmpty {
                Text(name).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
              }
            }
            Spacer(minLength: 8)
            SettingsChevron()
          }
        }
        .buttonStyle(.plain)
        link("Appearance", icon: "circle.lefthalf.filled", detail: appearance.title) {
          AppearanceSettingsView()
        }
        link("Notifications", icon: "bell") { NotificationSettingsView() }
      }

      SettingsSection(title: "Workspace") {
        link("Workspace", icon: "building.2", detail: model.workspace?.name) {
          WorkspaceSettingsView()
        }
        link(
          "Connection", icon: "dot.radiowaves.left.and.right",
          detail: model.isChiefCloudRelay ? "Chief Cloud" : "Self-hosted"
        ) { ConnectionSettingsView() }
        link("Missions", icon: "scope") { MissionsSettingsView() }
        link("Webhooks", icon: "arrow.triangle.branch") { WebhooksSettingsView() }
        link("Environment", icon: "key") { EnvironmentSettingsView() }
      }

      Text("Chief \(version) (\(build))")
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.tertiary)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("App version \(version), build \(build)")
    }
    .navigationTitle("Settings")
  }

  private func link<Destination: View>(
    _ title: String,
    icon: String,
    detail: String? = nil,
    @ViewBuilder destination: @escaping () -> Destination
  ) -> some View {
    NavigationLink(destination: destination) {
      SettingsDestination(title: title, icon: icon, detail: detail)
    }
    .buttonStyle(.plain)
  }

  private var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
  }

  private var build: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
  }
}
