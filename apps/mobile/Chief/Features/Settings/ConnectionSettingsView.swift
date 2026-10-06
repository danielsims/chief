import SwiftUI
import UIKit

struct ConnectionSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var copied = false

  var body: some View {
    SettingsPage(intro: "The relay and signed device identity used by this workspace.") {
      SettingsSection(title: "Relay") {
        SettingsValueRow(title: "Relay address", value: relayOrigin, monospaced: false) {
          Button {
            UIPasteboard.general.string = relayOrigin
            copied = true
            Haptics.light()
          } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
              .font(.system(size: 13))
              .foregroundStyle(ChiefTheme.secondary)
              .frame(width: 32, height: 32)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityLabel(copied ? "Relay address copied" : "Copy relay address")
        }
        SettingsValueRow(title: "Hosting", value: model.isChiefCloudRelay ? "Chief Cloud" : "Self-hosted")
        SettingsRow {
          Text("Status").foregroundStyle(ChiefTheme.secondary)
          Spacer()
          SettingsBadge(
            text: model.workspaceSyncFailed ? "Unavailable" : "Connected",
            dot: model.workspaceSyncFailed ? .orange : .green)
        }
        SettingsRow {
          Text("Identity").foregroundStyle(ChiefTheme.secondary)
          Spacer()
          Label("Signed device", systemImage: "checkmark.shield")
            .foregroundStyle(ChiefTheme.accent)
        }
      }
    }
    .navigationTitle("Connection")
  }

  private var relayOrigin: String {
    var components = URLComponents(
      url: model.appConfiguration.relayURL, resolvingAgainstBaseURL: false)
    components?.path = ""
    components?.query = nil
    components?.fragment = nil
    return components?.url?.absoluteString ?? model.appConfiguration.relayURL.absoluteString
  }
}
