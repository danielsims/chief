import SwiftUI

/// A catalog plugin before it's installed: what it is and the tools it offers,
/// with Install at the bottom. Desktop's plugin dialog, as a sheet.
struct PluginCatalogSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let plugin: PluginOption
  let onInstall: () -> Void
  @State private var tools: [WorkspacePluginConnection.Tool]?
  @State private var showsReads = false
  @State private var openTool: String?

  private var writes: [WorkspacePluginConnection.Tool] { (tools ?? []).filter { !$0.readOnly } }
  private var reads: [WorkspacePluginConnection.Tool] { (tools ?? []).filter(\.readOnly) }
  private var shown: [WorkspacePluginConnection.Tool] {
    showsReads || writes.isEmpty ? reads : writes
  }

  var body: some View {
    VStack(spacing: 0) {
      ChiefSheetHeader(title: "")
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          BrandLogoView(domain: plugin.domain, iconURL: plugin.iconURL, size: 52)
          VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(plugin.name).font(.system(size: 22, weight: .semibold))
              Text("Plugin").font(.system(size: 16)).foregroundStyle(ChiefTheme.secondary)
            }
            Text(plugin.description)
              .font(.system(size: 15))
              .foregroundStyle(ChiefTheme.primary.opacity(0.8))
            HStack(spacing: 8) {
              Circle().fill(ChiefTheme.secondary.opacity(0.6)).frame(width: 6, height: 6)
              Text("Requires setup").font(.system(size: 14)).foregroundStyle(ChiefTheme.secondary)
            }
            .padding(.top, 4)
          }
          toolsSection
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 24)
      }
      Button {
        dismiss()
        onInstall()
      } label: {
        Text("Install")
      }
      .buttonStyle(PrimaryButtonStyle())
      .padding(.horizontal, 24)
      .padding(.bottom, 12)
    }
    .chiefSheet([.large])
    .task {
      guard tools == nil, let workspaceID = model.workspace?.id else { return }
      tools = (try? await model.relay.pluginCatalogTools(workspaceID: workspaceID, domain: plugin.domain)) ?? []
    }
  }

  @ViewBuilder private var toolsSection: some View {
    if tools == nil {
      ChiefSpinner().tint(ChiefTheme.accent).frame(maxWidth: .infinity).padding(.top, 24)
    } else if tools?.isEmpty == true {
      Text("\(plugin.name) shows its tools once it's connected.")
        .font(.system(size: 14))
        .foregroundStyle(ChiefTheme.secondary)
        .padding(.top, 8)
    } else {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 18) {
          if !writes.isEmpty { groupButton("Write", count: writes.count, active: !showsReads) { showsReads = false } }
          if !reads.isEmpty { groupButton("Read", count: reads.count, active: showsReads || writes.isEmpty) { showsReads = true } }
        }
        .padding(.bottom, 10)
        Rectangle().fill(ChiefTheme.line).frame(height: 1)
        ForEach(shown, id: \.name) { tool in
          toolRow(tool)
          Rectangle().fill(ChiefTheme.line).frame(height: 1)
        }
      }
      .padding(.top, 8)
    }
  }

  private func groupButton(_ title: String, count: Int, active: Bool, action: @escaping () -> Void) -> some View {
    Button {
      openTool = nil
      action()
    } label: {
      HStack(spacing: 8) {
        Text(title).font(.system(size: 16, weight: .medium))
          .foregroundStyle(active ? ChiefTheme.primary : ChiefTheme.secondary)
        Text("\(count)")
          .font(.system(size: 12, weight: .medium))
          .monospacedDigit()
          .padding(.horizontal, 7)
          .frame(minWidth: 22, minHeight: 20)
          .foregroundStyle(active ? ChiefTheme.onPrimary : ChiefTheme.primary)
          .background(active ? ChiefTheme.primary : ChiefTheme.primary.opacity(0.1), in: Capsule())
      }
    }
    .buttonStyle(.plain)
  }

  private func toolRow(_ tool: WorkspacePluginConnection.Tool) -> some View {
    let open = openTool == tool.name
    return VStack(alignment: .leading, spacing: 8) {
      Button {
        withAnimation(.snappy(duration: 0.2)) { openTool = open ? nil : tool.name }
      } label: {
        HStack {
          Text(tool.title ?? tool.name).font(.system(size: 15, weight: .medium)).lineLimit(1)
          Spacer(minLength: 8)
          Image(systemName: "chevron.right")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(ChiefTheme.secondary)
            .rotationEffect(.degrees(open ? 90 : 0))
        }
        .frame(minHeight: 46)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      if open, let description = tool.description, !description.isEmpty {
        Text(description)
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
          .padding(.bottom, 12)
      }
    }
  }
}
