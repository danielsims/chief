import SwiftUI
import UIKit

/// The workspace's plugins, held by the relay, and the catalog to add more from.
struct PluginsView: View {
  @Environment(AppModel.self) private var model
  @State private var flow: PluginConnectFlow?
  @State private var plugins = PluginCatalogClient.shared.cached ?? PluginOption.preferred
  @State private var search = ""
  @State private var loading = false
  @State private var loadError: String?
  @State private var previewing: PluginOption?

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Plugins")
        .font(.system(size: 26, weight: .regular, design: .rounded))
        .tracking(-0.6)
        .frame(height: 34)
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.top, 16)
      ChiefSearchField(prompt: "Search plugins", text: $search)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if let loadError {
            SettingsNote(text: loadError, tone: .failure).padding(.bottom, 8)
          }
          if !addedConnections.isEmpty {
            PluginListHeader(title: "Installed")
            ForEach(addedConnections) { connection in
              NavigationLink {
                PluginDetailView(connection: connection)
              } label: {
                PluginConnectionRow(connection: connection, state: flow?.state(for: connection.pluginKey))
              }
              .buttonStyle(.plain)
              .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
            }
            PluginListHeader(title: "Available").padding(.top, 14)
          }
          if loading && plugins.isEmpty {
            ChiefSpinner()
              .tint(ChiefTheme.accent)
              .frame(maxWidth: .infinity)
              .padding(.top, 36)
          } else if availablePlugins.isEmpty && addedConnections.isEmpty {
            ContentUnavailableView.search(text: search)
              .foregroundStyle(ChiefTheme.secondary)
          } else {
            ForEach(availablePlugins) { plugin in
              PluginCatalogRow(
                plugin: plugin,
                busy: flow?.state(for: plugin.id) == .connecting,
                onSelect: {
                  Haptics.light()
                  previewing = plugin
                },
                onInstall: {
                  Haptics.medium()
                  flow?.connect(plugin)
                }
              )
            }
          }
        }
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.bottom, WorkspaceChrome.bottomClearance)
      }
      .refreshable { await load() }
    }
    .background(ChiefTheme.background)
    .task(id: model.workspace?.id) {
      guard let workspaceID = model.workspace?.id else { return }
      if flow?.workspaceID != workspaceID {
        flow = PluginConnectFlow(workspaceID: workspaceID, relay: model.relay)
      }
      loading = true
      async let catalog = PluginCatalogClient.shared.preferredPlugins()
      await load()
      plugins = await catalog
      loading = false
    }
    .onAppear { Task { await load() } }
    .modifier(OptionalPluginConnectSheets(flow: flow))
    .sheet(item: $previewing) { plugin in
      PluginCatalogSheet(plugin: plugin) { flow?.connect(plugin) }
    }
    .alert(
      "Couldn’t connect plugin",
      isPresented: Binding(
        get: { flow?.failure != nil },
        set: { if !$0 { flow?.failure = nil } }
      )
    ) {
      Button("OK", role: .cancel) { flow?.failure = nil }
    } message: {
      Text(flow?.failure ?? "Try again.")
    }
  }

  private var query: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

  private var addedConnections: [WorkspacePluginConnection] {
    (flow?.connections ?? []).filter {
      query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)
        || ($0.domain ?? "").localizedCaseInsensitiveContains(query)
    }
  }

  private var availablePlugins: [PluginOption] {
    let connections = flow?.connections ?? []
    let added = Set(connections.map(\.pluginKey))
    // Desktop and mobile name catalog entries differently, so the domain
    // also counts: a plugin installed anywhere isn't offered again.
    let addedDomains = Set(connections.compactMap { $0.domain?.lowercased() })
    return plugins.filter {
      !added.contains($0.id) && !addedDomains.contains($0.domain.lowercased())
        && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)
          || $0.domain.localizedCaseInsensitiveContains(query))
    }
  }

  private func load() async {
    guard let flow else { return }
    do {
      try await flow.load()
      loadError = nil
    } catch {
      loadError = PluginFailure.message(error, name: "plugins")
    }
  }
}

private struct PluginListHeader: View {
  let title: String

  var body: some View {
    Text(title)
      .font(.system(size: 13, weight: .medium))
      .foregroundStyle(ChiefTheme.secondary)
      .padding(.vertical, 6)
      .accessibilityAddTraits(.isHeader)
  }
}

private struct PluginCatalogRow: View {
  let plugin: PluginOption
  let busy: Bool
  let onSelect: () -> Void
  let onInstall: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      Button(action: onSelect) {
        HStack(spacing: 12) {
          BrandLogoView(domain: plugin.domain, iconURL: plugin.iconURL, size: 40)
          VStack(alignment: .leading, spacing: 3) {
            Text(plugin.name)
              .font(.system(size: 15, weight: .medium))
              .lineLimit(1)
            Text(plugin.description)
              .font(.system(size: 12))
              .foregroundStyle(ChiefTheme.secondary)
              .lineLimit(1)
          }
          Spacer(minLength: 8)
        }
        .frame(minHeight: 62)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(plugin.name)
      Button(action: onInstall) {
        PluginPill(title: "Install", busy: busy)
      }
      .buttonStyle(.plain)
      .disabled(busy)
      .accessibilityLabel("Install \(plugin.name)")
    }
  }
}

private struct PluginConnectionRow: View {
  let connection: WorkspacePluginConnection
  let state: PluginConnectState?

  var body: some View {
    HStack(spacing: 12) {
      BrandLogoView(domain: connection.domain ?? "", iconURL: connection.logoURL, size: 40)
      VStack(alignment: .leading, spacing: 3) {
        Text(connection.name)
          .font(.system(size: 15, weight: .medium))
          .lineLimit(1)
        Text(PluginStatusCopy.summary(connection))
          .font(.system(size: 12))
          .foregroundStyle(connection.status == "error" ? Color.red : ChiefTheme.secondary)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      if state == .connecting {
        ChiefSpinner().controlSize(.small).tint(ChiefTheme.accent)
      }
      SettingsChevron()
    }
    .frame(minHeight: 62)
    .contentShape(Rectangle())
  }
}

/// The small capsule action on plugin rows.
struct PluginPill: View {
  let title: String
  var busy = false
  var muted = false

  var body: some View {
    ZStack {
      Text(title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(muted ? ChiefTheme.secondary : .primary)
        .opacity(busy ? 0 : 1)
      if busy {
        ChiefSpinner()
          .controlSize(.small)
          .tint(ChiefTheme.accent)
      }
    }
    .padding(.horizontal, 12)
    .frame(minWidth: 58, minHeight: 29, maxHeight: 29)
    .background(ChiefTheme.elevated, in: Capsule())
  }
}

enum PluginStatusCopy {
  static func summary(_ connection: WorkspacePluginConnection) -> String {
    switch connection.status {
    case "connected": tools(connection)
    case "error": connection.error ?? "Error"
    default: "Not connected"
    }
  }

  static func tools(_ connection: WorkspacePluginConnection) -> String {
    let count = connection.tools?.count ?? 0
    return count == 1 ? "1 tool" : "\(count) tools"
  }
}

/// One added plugin: where it stands, and replacing its key, signing in
/// again or removing it. Members see it read-only.
struct PluginDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let connection: WorkspacePluginConnection
  @State private var flow: PluginConnectFlow?
  @State private var role: WorkspaceRole?
  @State private var confirmingRemove = false
  @State private var removing = false
  @State private var actionError: String?

  private var current: WorkspacePluginConnection {
    flow?.connection(for: connection.pluginKey) ?? connection
  }
  private var state: PluginConnectState { flow?.state(for: connection.pluginKey) ?? .idle }
  /// Unknown until members load; the relay refuses members either way.
  private var canManage: Bool { role?.canManage ?? true }

  var body: some View {
    VStack(spacing: 0) {
      PageDetailBar(title: current.name)
      SettingsPage {
        HStack(spacing: 14) {
          BrandLogoView(domain: current.domain ?? "", iconURL: current.logoURL, size: 48)
          VStack(alignment: .leading, spacing: 4) {
            Text(current.name).font(.system(size: 18, weight: .semibold))
            if let domain = current.domain {
              Text(domain).font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
            }
          }
        }
        SettingsSection(title: "Status") {
          SettingsValueRow(title: "Status", value: statusTitle)
          SettingsValueRow(title: "Tools", value: "\(current.tools?.count ?? 0)")
          if let error = current.error, current.status == "error" {
            SettingsNote(text: error, tone: .failure).padding(.top, 10)
          }
        }
        if current.isConnected {
          PluginAgentsSection(connectionID: current.id)
        }
        if canManage {
          SettingsSection(title: "Manage") {
            if current.auth?.kind == "headers" {
              SettingsActionRow(
                title: "Replace key", icon: "key", isWorking: state == .connecting
              ) { flow?.replaceKey(current) }
            } else if current.auth?.kind == "oauth" {
              SettingsActionRow(
                title: "Reconnect", icon: "arrow.clockwise", isWorking: state == .connecting
              ) { flow?.reconnect(current) }
            }
            SettingsActionRow(
              title: "Remove", icon: "trash", role: .destructive, isWorking: removing
            ) { confirmingRemove = true }
          }
        } else {
          SettingsNote(text: "Only workspace owners and admins can change plugins.")
        }
        if let message {
          SettingsNote(text: message, tone: .failure)
        }
      }
    }
    .toolbar(.hidden, for: .navigationBar)
    .background(InteractivePopEnabler())
    .background(ChiefTheme.background)
    .task {
      guard let workspaceID = model.workspace?.id else { return }
      if flow == nil { flow = PluginConnectFlow(workspaceID: workspaceID, relay: model.relay) }
      try? await flow?.load()
      if let members = try? await model.relay.workspaceMembers(workspaceID: workspaceID) {
        role = model.workspaceRole(in: members)
      }
    }
    .modifier(OptionalPluginConnectSheets(flow: flow))
    .alert("Remove \(current.name)?", isPresented: $confirmingRemove) {
      Button("Cancel", role: .cancel) {}
      Button("Remove", role: .destructive) { Task { await remove() } }
    } message: {
      Text("Agents in this workspace lose its tools.")
    }
  }

  private var statusTitle: String {
    switch current.status {
    case "connected": "Connected"
    case "error": "Error"
    default: "Not connected"
    }
  }

  private var message: String? {
    if let actionError { return actionError }
    if case .failed(let reason) = state, flow?.states[connection.pluginKey] != nil {
      return reason
    }
    return nil
  }

  private func remove() async {
    guard let flow else { return }
    removing = true
    actionError = nil
    defer { removing = false }
    do {
      try await flow.remove(current)
      Haptics.success()
      dismiss()
    } catch {
      actionError = PluginFailure.message(error, name: current.name)
      Haptics.error()
    }
  }
}

/// Which agents can use a plugin. A plugin is only offered to the agents it's
/// assigned to, through each agent's `integrations`.
struct PluginAgentsSection: View {
  @Environment(AppModel.self) private var model
  let connectionID: String
  @State private var access: PluginAgentAccess?
  @State private var saving: Set<String> = []
  @State private var error: String?
  private var agents: [AgentSummary] { model.workspace?.agents ?? [] }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let access {
        PluginAgentAccessList(agents: agents, selected: Set(access.assignedAgentIds), editable: saving.isEmpty,
          busy: saving, editableIDs: Set(access.agents.filter(\.canEdit).map(\.id)),
          notes: Dictionary(uniqueKeysWithValues: access.agents.map { ($0.id, $0.reason ?? ($0.deploymentTarget == "cloud" ? "Cloud" : $0.deploymentTarget == "phone" ? "Local · Phone" : "Local · Computer")) }),
          toggleMany: { ids, enabled in update(ids, enabled) }) { id in update([id], !access.assignedAgentIds.contains(id)) }
      } else if error == nil { ProgressView().frame(maxWidth: .infinity) }
      if let error { SettingsNote(text: error, tone: .failure) }
    }
    .task(id: connectionID) {
      guard let workspaceID = model.workspace?.id else { return }
      do { access = try await model.relay.pluginAgentAccess(workspaceID: workspaceID, connectionID: connectionID) }
      catch { self.error = error.localizedDescription }
    }
  }

  private func update(_ ids: [String], _ enabled: Bool) {
    guard let workspaceID = model.workspace?.id else { return }
    saving = Set(ids); error = nil
    Task {
      defer { saving = [] }
      do { access = try await model.relay.setPluginAgentAccess(workspaceID: workspaceID, connectionID: connectionID, agentIDs: ids, enabled: enabled); Haptics.selection() }
      catch { self.error = error.localizedDescription; Haptics.error() }
    }
  }
}

/// The key and OAuth app sheets a `PluginConnectFlow` asks for.
struct PluginConnectSheets: ViewModifier {
  @Bindable var flow: PluginConnectFlow

  func body(content: Content) -> some View {
    content
      .sheet(item: $flow.keyRequest, onDismiss: { flow.keySheetDismissed() }) { request in
        PluginAPIKeySheet(request: request)
      }
      .sheet(item: $flow.accessRequest) { connection in
        PluginInstallAccessSheet(connection: connection)
      }
      .sheet(item: $flow.clientRequest, onDismiss: { flow.clientSheetDismissed() }) { request in
        PluginOAuthClientSheet(request: request)
      }
  }
}

/// For screens that create their flow once the workspace is known.
struct OptionalPluginConnectSheets: ViewModifier {
  let flow: PluginConnectFlow?

  func body(content: Content) -> some View {
    if let flow {
      content.modifier(PluginConnectSheets(flow: flow))
    } else {
      content
    }
  }
}

/// Asks for the key a plugin signs in with. The relay checks it against the
/// server before keeping it, so a rejected key leaves the sheet open.
/// Desktop's `PluginApiKeyDialog`.
struct PluginAPIKeySheet: View {
  @Environment(\.dismiss) private var dismiss
  let request: PluginKeyRequest
  @State private var key = ""
  @State private var busy = false
  @State private var error: String?

  private var name: String { request.pluginName }
  private var label: String { request.header.label }
  private var trimmedKey: String { key.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(
        title: request.replacing ? "Replace \(label)" : "Connect \(name)", doneTitle: "Cancel")
      ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        Text(instructions)
          .font(.system(size: 14))
          .foregroundStyle(ChiefSheetPalette.secondary)
          .tint(ChiefTheme.accent)
          .fixedSize(horizontal: false, vertical: true)
        SettingsTextField(
          title: label.prefix(1).uppercased() + label.dropFirst(),
          text: $key, placeholder: "Paste a key", secure: true)
          .disabled(busy)
          .onChange(of: key) { error = nil }
        if let error { SettingsNote(text: error, tone: .failure) }
        Spacer(minLength: 0)
        Button {
          Haptics.heavy()
          Task { await submit() }
        } label: {
          if busy {
            ChiefSpinner().tint(ChiefTheme.onPrimary)
          } else {
            Text(request.replacing ? "Save" : "Connect")
          }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy || trimmedKey.isEmpty)
      }
      .padding(.horizontal, 24)
      .padding(.bottom, 20)
      }
    }
    .chiefSheet([.height(330)])
    .interactiveDismissDisabled(busy)
  }

  private var instructions: AttributedString {
    var text = AttributedString("Get your \(label) from ")
    var provider = AttributedString(name)
    if let docsURL = request.header.docsURL {
      provider.link = docsURL
      provider.underlineStyle = .single
    }
    text.append(provider)
    text.append(AttributedString("."))
    return text
  }

  private func submit() async {
    guard !trimmedKey.isEmpty, !busy else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await request.submit(trimmedKey)
    } catch {
      self.error = PluginFailure.message(error, name: name)
      Haptics.error()
      return
    }
    Haptics.success()
    dismiss()
  }
}

/// Registers an OAuth app the person made at the provider, for providers
/// that don't let Chief register one itself. Desktop's `PluginOAuthClientDialog`.
struct PluginOAuthClientSheet: View {
  @Environment(\.dismiss) private var dismiss
  let request: PluginClientRequest
  @State private var clientID = ""
  @State private var clientSecret = ""
  @State private var busy = false
  @State private var copied = false
  @State private var addingCredentials = false
  @State private var error: String?

  private var trimmedID: String { clientID.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(title: "Set up \(request.pluginName)", doneTitle: "Cancel")
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          HStack(spacing: 12) {
            BrandLogoView(domain: request.domain ?? request.pluginKey, iconURL: nil, size: 40)
            Text("Connect using your OAuth app.")
              .font(.system(size: 14)).foregroundStyle(ChiefSheetPalette.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
          HStack(spacing: 8) {
            Text("1. Create app").foregroundStyle(addingCredentials ? ChiefTheme.secondary : ChiefTheme.primary)
            Image(systemName: "chevron.right").font(.system(size: 10))
            Text("2. Add credentials").foregroundStyle(addingCredentials ? ChiefTheme.primary : ChiefTheme.secondary)
          }
          .font(.system(size: 13, weight: .medium))
          .accessibilityElement(children: .combine)
          if !addingCredentials {
            VStack(alignment: .leading, spacing: 8) {
              Text("Create an app for Chief").font(.system(size: 17, weight: .semibold))
              Text("Create an OAuth app in \(request.pluginName)’s developer settings.")
                .font(.system(size: 14)).foregroundStyle(ChiefSheetPalette.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            if let domain = request.domain, let url = URL(string: "https://\(domain)") {
              Link(destination: url) {
                Label("Open \(request.pluginName)", systemImage: "arrow.up.right")
                  .font(.system(size: 14, weight: .medium))
              }
              .tint(ChiefTheme.accent)
            }
            if let callbackURL = request.callbackURL { redirectRow(callbackURL) }
          } else {
            VStack(alignment: .leading, spacing: 8) {
              Text("Add your app credentials").font(.system(size: 17, weight: .semibold))
              Text("Enter your app credentials. Next, approve access at \(request.pluginName).")
                .font(.system(size: 14)).foregroundStyle(ChiefSheetPalette.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            SettingsTextField(
              title: "Client ID", text: $clientID, placeholder: "Enter your client ID",
              capitalization: .never)
              .autocorrectionDisabled().disabled(busy)
            SettingsTextField(
              title: "Client secret · Optional for public apps", text: $clientSecret,
              placeholder: "Enter your client secret", secure: true)
              .disabled(busy)
            Label {
              Text("Encrypted on your workspace relay.")
                .font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
            } icon: { Image(systemName: "lock.shield").font(.system(size: 16)) }
              .foregroundStyle(ChiefSheetPalette.secondary)
          }
          if let error { SettingsNote(text: error, tone: .failure) }
          Button {
            Haptics.heavy()
            if addingCredentials { Task { await submit() } } else { addingCredentials = true }
          } label: {
            if busy { ChiefSpinner().tint(ChiefTheme.onPrimary) } else {
              Text(addingCredentials ? "Continue to sign-in" : "Continue")
            }
          }
          .buttonStyle(PrimaryButtonStyle())
          .disabled(busy || (addingCredentials && trimmedID.isEmpty))
          if addingCredentials {
            Button("Back to app setup") { addingCredentials = false }
              .font(.system(size: 14, weight: .medium)).tint(ChiefTheme.secondary)
              .frame(maxWidth: .infinity).disabled(busy)
          }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 20)
      }
    }
    .chiefSheet([.large])
    .interactiveDismissDisabled(busy)
    .onChange(of: clientID) { error = nil }
    .onChange(of: clientSecret) { error = nil }
  }

  private func redirectRow(_ url: URL) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Redirect URL").font(.system(size: 13, weight: .medium)).foregroundStyle(ChiefTheme.primary)
      HStack(spacing: 10) {
        Text(url.absoluteString)
          .font(.system(size: 14))
          .lineLimit(2)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
        Button(copied ? "Copied" : "Copy") {
          UIPasteboard.general.string = url.absoluteString
          Haptics.light()
          copied = true
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(ChiefTheme.accent)
      }
      Text("Add this exact redirect URL to your app.")
        .font(.system(size: 12)).foregroundStyle(ChiefSheetPalette.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(16)
    .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 12))
  }

  private func submit() async {
    guard !trimmedID.isEmpty, !busy else { return }
    busy = true
    error = nil
    defer { busy = false }
    let secret = clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
    do {
      try await request.submit(trimmedID, secret.isEmpty ? nil : secret)
      dismiss()
    } catch {
      self.error = PluginFailure.message(error, name: request.pluginName)
      Haptics.error()
    }
  }
}
