import BrowserUI
import BrowserUIWebKit
import SwiftUI
import UIKit

struct MessageComponentList: View {
  @Environment(AppModel.self) private var model
  let message: ConversationMessage

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(visibleComponents) { component in
        componentView(component)
      }
    }
    .padding(.top, visibleComponents.isEmpty ? 0 : 4)
  }

  private var visibleComponents: [MessageComponent] {
    message.components.filter { component in
      switch component.kind {
      case "artifact.reference", "question", "attachment", "plugin.recommendation", "plugin.authorization", "project.recommendation": true
      case "tool":
        component.payload["name"] == BrowserReleaseTool.name
          && component.payload["status"] == "completed"
      default: false
      }
    }
  }

  @ViewBuilder
  private func componentView(_ component: MessageComponent) -> some View {
    switch component.kind {
    case "artifact.reference":
      ArtifactMessageComponent(message: message, component: component)
    case "question":
      QuestionMessageComponent(component: component) { option in
        answer(with: option)
      }
    case "thinking":
      EmptyView()
    case "tool":
      if component.payload["name"] == BrowserReleaseTool.name,
        component.payload["status"] == "completed",
        let output = component.payload["output"],
        let release = try? JSONDecoder().decode(
          BrowserSessionReleaseRequest.self,
          from: Data(output.utf8)
        )
      {
        ReleasedBrowserMessageComponent(message: message, release: release)
      }
    case "attachment":
      AttachmentMessageComponent(component: component)
    case "plugin.recommendation":
      PluginRecommendationMessageComponent(
        message: message,
        component: component
      )
    case "plugin.authorization":
      PluginAuthorizationMessageComponent(message: message, component: component)
    case "project.recommendation":
      ProjectRecommendationMessageComponent(component: component)
    default:
      EmptyView()
    }
  }

  /// The answer is an ordinary reply in the question's thread, addressed to
  /// the agent that asked, so it reaches that agent as its next turn.
  private func answer(with option: String) {
    guard let workspaceID = model.workspace?.id else { return }
    guard let agentID = message.author.agentID else { return }

    Haptics.heavy()
    Task {
      do {
        let response = try await model.relay.send(
          body: option,
          workspaceID: workspaceID,
          conversationID: message.conversationID,
          threadRootID: message.threadRootID ?? message.id,
          mentions: [agentID],
          components: []
        )
        model.conversations.merge(response)
      } catch {
        Haptics.error()
        print("[Chief] question answer failed: \(error)")
      }
    }
  }
}

/// Connects a plugin from a chat card through the same relay flow as the
/// Plugins page. The card's own link may be stale, so every connect asks the
/// relay for a fresh sign-in.
@MainActor
private struct PluginCardConnector {
  let model: AppModel
  let message: ConversationMessage
  let component: MessageComponent

  /// The card's plugin, if the card still belongs to this conversation.
  func plugin(
    id: String?, name: String, domain: String?, description: String?
  ) async throws -> PluginOption {
    guard component.payload["workspaceId"] == message.workspaceID,
      component.payload["conversationId"] == message.conversationID,
      let id
    else { throw PluginConnectError("This plugin card no longer matches this conversation.") }
    guard
      let plugin = await PluginCatalogClient.shared.plugin(
        id: id, name: name, domain: domain, description: description)
    else { throw PluginConnectError("This plugin is no longer in the catalog.") }
    return plugin
  }

  /// The agent that posted the card, pre-ticked when choosing who gets the plugin.
  var agentID: String? { component.payload["agentId"] ?? message.author.agentID }

  func flow(_ current: PluginConnectFlow?) -> PluginConnectFlow {
    current ?? PluginConnectFlow(workspaceID: message.workspaceID, relay: model.relay)
  }
}

@MainActor
private struct PluginAuthorizationMessageComponent: View {
  @Environment(AppModel.self) private var model
  let message: ConversationMessage
  let component: MessageComponent
  @State private var flow: PluginConnectFlow?
  @State private var resolving = false
  @State private var errorMessage: String?

  private var name: String { component.payload["pluginName"] ?? "Plugin" }
  private var pluginID: String? { component.payload["pluginId"] }
  private var needsKey: Bool { component.payload["kind"] == "plugin_api_key" }
  private var state: PluginConnectState {
    pluginID.flatMap { flow?.state(for: $0) } ?? .idle
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Label(needsKey ? "Connect \(name)" : "Authorize \(name)", systemImage: "link.badge.plus")
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(.primary)
      if let description = component.payload["description"] {
        Text(description)
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
      }
      if state == .connected {
        Label("Connected", systemImage: "checkmark.circle.fill")
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(.green)
      } else {
        Button("Continue securely") { connect() }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
          .disabled(resolving || state == .connecting)
      }
      if let error = errorMessage ?? failure {
        Text(error)
          .font(.system(size: 11))
          .foregroundStyle(.red)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12)
        .stroke(ChiefTheme.line, lineWidth: 0.5)
    }
    .modifier(OptionalPluginConnectSheets(flow: flow))
  }

  private var failure: String? {
    if case .failed(let reason) = state { reason } else { nil }
  }

  private func connect() {
    let connector = PluginCardConnector(model: model, message: message, component: component)
    let provider = component.payload["provider"]
    resolving = true
    errorMessage = nil
    Haptics.medium()
    Task {
      defer { resolving = false }
      do {
        let plugin = try await connector.plugin(
          id: pluginID, name: name,
          domain: provider?.contains(".") == true ? provider : nil,
          description: component.payload["description"])
        let flow = connector.flow(flow)
        self.flow = flow
        flow.connect(plugin, agentID: connector.agentID)
      } catch {
        errorMessage = PluginFailure.message(error, name: name)
        Haptics.error()
      }
    }
  }
}

@MainActor
private struct PluginRecommendationMessageComponent: View {
  @Environment(AppModel.self) private var model
  let message: ConversationMessage
  let component: MessageComponent
  @State private var flow: PluginConnectFlow?
  @State private var resolving = false
  @State private var errorMessage: String?

  private var name: String {
    component.payload["name"] ?? component.payload["pluginId"] ?? "Plugin"
  }
  private var pluginID: String? { component.payload["pluginId"] }
  private var state: PluginConnectState? { pluginID.flatMap { flow?.state(for: $0) } }
  private var connected: Bool {
    state == .connected || (state == nil && component.payload["status"] == "connected")
  }
  private var busy: Bool { resolving || state == .connecting }
  private var domain: String {
    component.payload["domain"] ?? component.payload["pluginId"] ?? ""
  }
  private var iconURL: URL? {
    component.payload["iconUrl"].flatMap(URL.init(string:))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 12) {
        BrandLogoView(domain: domain, iconURL: iconURL, size: 40)

        Text(name)
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(.primary)
          .lineLimit(1)
        Spacer(minLength: 8)

        if connected {
          Label("Added", systemImage: "checkmark.circle.fill")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.green)
        } else {
          Button {
            connectPlugin()
          } label: {
            ZStack {
              Text("Add")
                .opacity(busy ? 0 : 1)
              if busy {
                ChiefSpinner()
                  .controlSize(.small)
                  .tint(ChiefTheme.accent)
              }
            }
            .frame(minWidth: 34)
          }
          .buttonStyle(.bordered)
          .controlSize(.small)
          .disabled(busy)
        }
      }

      if let error = errorMessage ?? failure {
        Text(error)
          .font(.system(size: 11))
          .foregroundStyle(.red)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ChiefTheme.elevated.opacity(0.7), in: RoundedRectangle(cornerRadius: 16))
    .overlay {
      RoundedRectangle(cornerRadius: 16)
        .stroke(ChiefTheme.line, lineWidth: 0.5)
    }
    .modifier(OptionalPluginConnectSheets(flow: flow))
  }

  private var failure: String? {
    if case .failed(let reason) = state { reason } else { nil }
  }

  private func connectPlugin() {
    let connector = PluginCardConnector(model: model, message: message, component: component)
    resolving = true
    errorMessage = nil
    Haptics.medium()
    Task {
      defer { resolving = false }
      do {
        let plugin = try await connector.plugin(
          id: pluginID, name: name,
          domain: domain == pluginID ? nil : domain,
          description: component.payload["description"])
        let flow = connector.flow(flow)
        self.flow = flow
        flow.connect(plugin, agentID: connector.agentID)
      } catch {
        errorMessage = PluginFailure.message(error, name: name)
        Haptics.error()
      }
    }
  }
}

@MainActor
private struct ReleasedBrowserMessageComponent: View {
  let message: ConversationMessage
  let release: BrowserSessionReleaseRequest
  @State private var showsBrowser = false

  private var agentID: String { message.author.agentID ?? "chief" }
  private var scope: String {
    "\(message.workspaceID):\(agentID):\(message.conversationID)"
  }
  private var label: String {
    release.label
      ?? (release.outcome == .waiting ? "Browser ready for you" : "Browsing session complete")
  }
  private var detail: String? {
    guard let rawURL = release.url, let host = URL(string: rawURL)?.host else {
      return release.title
    }
    return host.replacingOccurrences(of: "www.", with: "")
  }

  var body: some View {
    BrowserSessionReleasedView(label: label, detail: detail) {
      Haptics.medium()
      showsBrowser = true
    }
    .padding(.vertical, 6)
    .fullScreenCover(isPresented: $showsBrowser) {
      ReleasedAgentBrowserTakeover(
        scope: scope,
        expectedSessionID: release.sessionId,
        fallbackURL: release.url,
        isPresented: $showsBrowser
      )
    }
  }
}

@MainActor
private struct ReleasedAgentBrowserTakeover: View {
  let scope: String
  let expectedSessionID: String
  let fallbackURL: String?
  @Binding var isPresented: Bool

  @State private var isRestoring = true
  @State private var restorationError: String?

  private var driver: WebKitBrowserDriver {
    AgentBrowserSession.driver(for: scope)
  }

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      WebKitBrowserView(
        driver: driver,
        revision: driver.surfaceRevision,
        presentationMode: .takeover,
        displayMode: driver.displayMode
      )
      .ignoresSafeArea()

      if isRestoring {
        ChiefSpinner(label: "Restoring browser")
          .tint(.white)
          .foregroundStyle(.white)
          .padding(16)
          .background(.black.opacity(0.7), in: Capsule())
      } else if let restorationError {
        ContentUnavailableView(
          "Browser unavailable",
          systemImage: "exclamationmark.triangle",
          description: Text(restorationError)
        )
        .foregroundStyle(.white)
      }
    }
    .overlay(alignment: .topTrailing) {
      Button {
        isPresented = false
      } label: {
        Image(systemName: "xmark")
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(.white)
          .frame(width: 38, height: 38)
          .background(.black.opacity(0.58), in: Circle())
      }
      .padding(16)
      .accessibilityLabel("Close browser")
    }
    .task { await restoreBrowserIfNeeded() }
    .onDisappear { Task { await driver.restoreDesktopViewport() } }
  }

  private func restoreBrowserIfNeeded() async {
    restorationError = nil
    do {
      if driver.scope != scope || driver.lifecycleSessionId != expectedSessionID {
        guard let fallbackURL else {
          throw ToolError.noActiveBrowser
        }
        driver.begin(scope: scope)
        _ = try await driver.navigate(fallbackURL)
        driver.releaseAgentControl()
      }
      await driver.enterTakeoverViewport()
      isRestoring = false
    } catch {
      restorationError =
        (error as? LocalizedError)?.errorDescription ?? "The page could not be restored."
      isRestoring = false
    }
  }
}

extension ConversationMessage.Author {
  var agentID: String? {
    switch self {
    case .agent(let id, _): id
    case .system: "chief"
    case .user: nil
    }
  }
}

private struct AttachmentMessageComponent: View {
  let component: MessageComponent
  @State private var showsFullImage = false

  private var url: URL? {
    (component.payload["url"] ?? component.payload["src"]).flatMap(URL.init(string:))
  }

  var body: some View {
    Group {
      if let url {
        AuthenticatedRelayImage(url: url, contentMode: .fill)
          .frame(width: 240, height: 180)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(ChiefTheme.line)
          }
          .contentShape(Rectangle())
          .onTapGesture { showsFullImage = true }
          .accessibilityLabel(component.payload["name"] ?? "Image attachment")
          .accessibilityAddTraits(.isButton)
      }
    }
    .fullScreenCover(isPresented: $showsFullImage) {
      FullScreenAttachmentView(url: url, isPresented: $showsFullImage)
    }
  }
}

private struct FullScreenAttachmentView: View {
  let url: URL?
  @Binding var isPresented: Bool

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      if let url {
        AuthenticatedRelayImage(url: url, contentMode: .fit)
          .padding(20)
      }
      VStack {
        HStack {
          Spacer()
          Button {
            isPresented = false
          } label: {
            Image(systemName: "xmark.circle.fill")
              .font(.system(size: 28))
              .foregroundStyle(.white.opacity(0.8))
          }
          .accessibilityLabel("Close")
        }
        Spacer()
      }
      .padding(16)
    }
  }
}

private struct AuthenticatedRelayImage: View {
  let url: URL
  let contentMode: ContentMode

  @State private var image: UIImage?
  @State private var failed = false

  var body: some View {
    ZStack {
      Rectangle().fill(ChiefTheme.elevated)
      if let image {
        Image(uiImage: image)
          .resizable()
          .aspectRatio(contentMode: contentMode)
      } else if failed {
        Image(systemName: "photo.badge.exclamationmark")
          .foregroundStyle(ChiefTheme.tertiary)
      } else {
        ChiefSpinner().controlSize(.small)
      }
    }
    .clipped()
    .task(id: url) { await load() }
  }

  private func load() async {
    failed = false
    let relayURL = AppConfiguration.current().relayURL
    guard url.scheme == relayURL.scheme,
      url.host() == relayURL.host(),
      url.port == relayURL.port,
      url.path.contains("/attachments/")
    else {
      failed = true
      return
    }

    var request = URLRequest(url: url)
    request.timeoutInterval = 20

    do {
      request.setValue(
        try NIP98Authenticator.header(method: "GET", url: url),
        forHTTPHeaderField: "authorization"
      )
    } catch {
      failed = true
      return
    }
    // The relay binds requests to this device, as every other relay call does.
    if let deviceAuthorization = await DeviceAuthorizationVault.shared.load(for: relayURL) {
      request.setValue(deviceAuthorization, forHTTPHeaderField: "x-chief-device-authorization")
    }

    do {
      // Never follow a redirect: it would carry the device's credentials along.
      let (data, response) = try await URLSession.shared.data(
        for: request, delegate: RefuseRedirects())
      guard let http = response as? HTTPURLResponse,
        (200..<300).contains(http.statusCode),
        let decoded = UIImage(data: data)
      else {
        failed = true
        return
      }
      image = decoded
    } catch is CancellationError {
      return
    } catch {
      failed = true
    }
  }
}

struct ThinkingMessageComponent: View {
  let component: MessageComponent
  @State private var isExpanded = true

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Button {
        withAnimation { isExpanded.toggle() }
      } label: {
        HStack(spacing: 8) {
          if component.payload["status"] == "running" {
            ChiefShimmerText("Thinking")
          } else {
            Text("Thinking")
              .font(.system(size: 12, weight: .medium))
          }
          Spacer()
          Image(systemName: "chevron.down")
            .font(.system(size: 10, weight: .semibold))
            .rotationEffect(.degrees(isExpanded ? 180 : 0))
        }
        .foregroundStyle(ChiefTheme.secondary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      if isExpanded, let text = component.payload["text"] ?? component.payload["content"] {
        Text(text)
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .lineSpacing(2)
          .textSelection(.enabled)
          .padding(.leading, 11)
          .overlay(alignment: .leading) {
            Rectangle()
              .fill(ChiefTheme.line)
              .frame(width: 1)
          }
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 11)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct ToolMessageComponent: View {
  let component: MessageComponent
  @State private var isExpanded: Bool

  init(component: MessageComponent) {
    self.component = component
    let status = component.payload["status"] ?? "running"
    _isExpanded = State(
      initialValue: ["running", "working", "failed", "error"].contains(status)
    )
  }

  private var name: String { component.payload["name"] ?? "tool" }
  private var status: String { component.payload["status"] ?? "running" }
  private var input: String? { component.payload["input"] ?? component.payload["parameters"] }
  private var output: String? { component.payload["output"] ?? component.payload["result"] }
  private var error: String? { component.payload["error"] }
  private var displayName: String {
    let clean =
      name
      .replacingOccurrences(of: "relay_", with: "")
      .replacingOccurrences(of: "_", with: " ")
    return clean.prefix(1).uppercased() + clean.dropFirst()
  }
  private var summary: String? {
    for key in ["description", "path", "query", "url", "command"] {
      if let value = component.payload[key], !value.isEmpty { return value }
    }
    return nil
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button {
        withAnimation(.easeOut(duration: 0.18)) { isExpanded.toggle() }
      } label: {
        HStack(spacing: 9) {
          statusIcon
          Text(displayName)
            .font(.system(size: 13, weight: .medium))
          if let summary {
            Text(summary)
              .font(.system(size: 12))
              .foregroundStyle(ChiefTheme.tertiary)
              .lineLimit(1)
          }
          Spacer(minLength: 8)
          statusLabel
          Image(systemName: "chevron.down")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(ChiefTheme.tertiary)
            .rotationEffect(.degrees(isExpanded ? 180 : 0))
        }
        .foregroundStyle(ChiefTheme.secondary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      if isExpanded {
        VStack(alignment: .leading, spacing: 8) {
          detailBlock(title: "Tool", text: name)
          if let input { detailBlock(title: "Parameters", text: input) }
          if let output { detailBlock(title: "Result", text: output) }
          if let error { detailBlock(title: "Error", text: error) }
        }
        .padding(.top, 10)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 11)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var statusIcon: some View {
    switch status {
    case "running", "working":
      MatrixLoader(size: 12).foregroundStyle(ChiefTheme.secondary)
    case "failed", "error":
      Image(systemName: "exclamationmark.circle.fill")
        .font(.system(size: 12))
        .foregroundStyle(.red)
    default:
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.secondary)
    }
  }

  @ViewBuilder
  private var statusLabel: some View {
    Group {
      switch status {
      case "running", "working":
        Text("Working").foregroundStyle(ChiefTheme.tertiary)
      case "failed", "error":
        Text("Failed").foregroundStyle(.red)
      default:
        Text("Done").foregroundStyle(ChiefTheme.tertiary)
      }
    }
    .font(.system(size: 10))
  }

  private func detailBlock(title: String, text: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title)
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(ChiefTheme.tertiary)
      Text(text)
        .font(.system(size: 12, design: .monospaced))
        .foregroundStyle(ChiefTheme.secondary)
        .textSelection(.enabled)
        .lineLimit(12)
    }
  }
}

struct AgentRunErrorComponent: View {
  let component: MessageComponent
  let onRetry: (() -> Void)?

  init(component: MessageComponent, onRetry: (() -> Void)? = nil) {
    self.component = component
    self.onRetry = onRetry
  }

  private var title: String { component.payload["title"] ?? "Run failed" }
  private var message: String {
    component.payload["message"] ?? "The agent couldn't complete this run."
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      Label(title, systemImage: "exclamationmark.circle")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.red)
      Text(message)
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
        .lineSpacing(2)
        .textSelection(.enabled)
      if let onRetry {
        Button("Retry run", action: onRetry)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(ChiefTheme.accent)
          .buttonStyle(.plain)
          .padding(.top, 2)
      }
    }
    .padding(11)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    .overlay {
      RoundedRectangle(cornerRadius: 10)
        .stroke(Color.red.opacity(0.2), lineWidth: 0.5)
    }
  }
}

private struct QuestionMessageComponent: View {
  let component: MessageComponent
  let onSelect: (String) -> Void
  @State private var selectedOption: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(options, id: \.self) { option in
        Button {
          selectedOption = option
          onSelect(option)
        } label: {
          HStack {
            Text(option)
            Spacer()
            if selectedOption == option {
              Image(systemName: "checkmark")
            }
          }
          .font(.system(size: 13, weight: .medium))
          .padding(.horizontal, 10)
          .frame(height: 42)
          .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10))
          .overlay {
            RoundedRectangle(cornerRadius: 10)
              .stroke(selectedOption == option ? ChiefTheme.accent : ChiefTheme.line)
          }
        }
        .buttonStyle(.plain)
        .disabled(selectedOption != nil)
      }
    }
    .padding(.top, 4)
  }

  private var options: [String] { component.payloadArrays["options"] ?? [] }
}

@MainActor
private struct ProjectRecommendationMessageComponent: View {
  let component: MessageComponent
  @Environment(AppModel.self) private var model
  @State private var showsConnect = false

  private var title: String {
    component.payload["title"] ?? "Connect a repository"
  }
  private var description: String {
    component.payload["description"] ?? "Add the Git repository this workspace should work in."
  }
  private var remoteURL: String? { component.payload["remoteUrl"] }
  private var alreadyConnected: Bool {
    guard let remoteURL else { return false }
    return model.workspace?.projects.contains {
      $0.canonicalRemoteURL == remoteURL || $0.repositoryWebURL == remoteURL
    } == true
  }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "folder.badge.gearshape")
        .font(.system(size: 18))
        .frame(width: 40, height: 40)
        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 12))
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 14, weight: .medium))
          .lineLimit(1)
        Text(hostLabel)
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      if alreadyConnected {
        Label("Connected", systemImage: "checkmark.circle.fill")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.green)
          .labelStyle(.titleAndIcon)
      } else {
        Button("Connect") { showsConnect = true }
          .buttonStyle(.bordered)
          .controlSize(.small)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ChiefTheme.elevated.opacity(0.7), in: RoundedRectangle(cornerRadius: 16))
    .overlay {
      RoundedRectangle(cornerRadius: 16).stroke(ChiefTheme.line, lineWidth: 0.5)
    }
    .sheet(isPresented: $showsConnect) {
      AddRepositorySheet(initialRemoteURL: remoteURL ?? "")
    }
  }

  private var hostLabel: String {
    if let remoteURL, let host = URL(string: remoteURL)?.host {
      return host.replacingOccurrences(of: "www.", with: "")
    }
    return description
  }
}

/// Stops a request at its first redirect instead of following it.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest
  ) async -> URLRequest? {
    nil
  }
}
