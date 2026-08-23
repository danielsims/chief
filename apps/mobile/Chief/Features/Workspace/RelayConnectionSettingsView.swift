import SwiftUI
import UIKit

struct RelayConnectionSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var copied = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        connectionCard
      }
      .padding(ChiefTheme.pagePadding)
    }
    .background(ChiefTheme.background)
    .navigationTitle("Connection")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var connectionCard: some View {
    VStack(spacing: 0) {
      HStack(alignment: .top, spacing: 13) {
        Group {
          if isChiefCloud {
            Image(systemName: "cloud.fill")
          } else {
            Image(systemName: "server.rack")
          }
        }
        .font(.system(size: 18, weight: .medium))
        .frame(width: 42, height: 42)
        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 12))

        VStack(alignment: .leading, spacing: 4) {
          Text(model.workspace?.name ?? "Workspace connection")
            .font(.system(size: 17, weight: .semibold))
          Text(
            isChiefCloud
              ? "Chief manages this workspace’s relay and updates."
              : "This workspace runs on infrastructure managed by your team."
          )
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 4)
      }
      .padding(16)

      Divider().overlay(ChiefTheme.line)
      detailRow("Status") {
        Label(
          model.workspaceSyncFailed ? "Unavailable" : "Connected",
          systemImage: model.workspaceSyncFailed ? "exclamationmark.circle.fill" : "circle.fill"
        )
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(model.workspaceSyncFailed ? Color.orange : Color.green)
      }
      Divider().overlay(ChiefTheme.line)
      detailRow("Hosting") {
        Text(isChiefCloud ? "Chief Cloud" : "Self-hosted")
      }
      Divider().overlay(ChiefTheme.line)
      detailRow("Relay address") {
        Button {
          UIPasteboard.general.string = relayOrigin
          copied = true
          Haptics.light()
          Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
          }
        } label: {
          HStack(spacing: 7) {
            Text(relayHost)
              .lineLimit(1)
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
          }
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(copied ? "Relay address copied" : "Copy relay address")
      }
      Divider().overlay(ChiefTheme.line)
      detailRow("Identity") {
        Label("Signed device", systemImage: "checkmark.shield")
          .font(.system(size: 13))
      }
    }
    .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: ChiefTheme.cardRadius))
    .overlay {
      RoundedRectangle(cornerRadius: ChiefTheme.cardRadius)
        .stroke(ChiefTheme.line, lineWidth: 1)
    }
  }

  private func detailRow<Content: View>(
    _ label: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    HStack(spacing: 16) {
      Text(label)
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
      Spacer(minLength: 16)
      content()
    }
    .frame(minHeight: 50)
    .padding(.horizontal, 16)
  }

  private var isChiefCloud: Bool {
    RelayDirectoryStore.sameOrigin(
      model.appConfiguration.relayURL,
      AppConfiguration.chiefCloud().relayURL
    )
  }

  private var relayOrigin: String {
    var components = URLComponents(
      url: model.appConfiguration.relayURL,
      resolvingAgainstBaseURL: false
    )
    components?.path = ""
    components?.query = nil
    components?.fragment = nil
    return components?.url?.absoluteString ?? model.appConfiguration.relayURL.absoluteString
  }

  private var relayHost: String {
    model.appConfiguration.relayURL.host ?? relayOrigin
  }
}
