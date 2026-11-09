import SwiftUI

struct PluginInstallAccessSheet: View {
  let connection: WorkspacePluginConnection
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      ChiefSheetHeader(title: "\(connection.name) is connected")
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          BrandLogoView(domain: connection.domain ?? connection.pluginKey, iconURL: connection.logoURL, size: 44)
          Text("Choose which of your agents can use it.")
            .font(.system(size: 14)).foregroundStyle(ChiefTheme.secondary)
          PluginAgentsSection(connectionID: connection.id)
        }
        .padding(.horizontal, 24).padding(.bottom, 24)
      }
    }
    .chiefSheet([.large])
  }
}
