import BrowserUI
import BrowserUIWebKit
import SwiftUI
import UIKit

struct MessageComponentList: View {
  @Environment(AppModel.self) private var model
  let message: ConversationMessage

  var body: some View {
    ForEach(message.components) { component in
      componentView(component)
    }
  }

  @ViewBuilder
  private func componentView(_ component: MessageComponent) -> some View {
    switch component.kind {
    case "action-request":
      ActionRequestMessageComponent(component: component) { option in
        respond(to: component, with: option)
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
    default:
      EmptyView()
    }
  }

  private func respond(to component: MessageComponent, with option: String) {
    guard let workspaceID = model.workspace?.id else { return }
    guard let agentID = message.author.agentID else { return }

    Haptics.heavy()
    Task {
      do {
        let response = try await model.relay.send(
          body: option,
          workspaceID: workspaceID,
          conversationID: message.conversationID,
          threadRootID: message.threadRootID,
          mentions: [agentID],
          components: [
            MessageComponent(
              id: UUID().uuidString,
              kind: "action-response",
              payload: ["requestId": component.id, "selection": option]
            )
          ]
        )
        model.conversations.merge(response)
        await model.runAgentTurn(
          conversationID: message.conversationID,
          threadRootID: message.threadRootID,
          mentions: [agentID],
          agentID: agentID
        )
      } catch {
        Haptics.error()
        print("[Chief] action response failed: \(error)")
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
        displayMode: .inline
      )
      .ignoresSafeArea()

      if isRestoring {
        ProgressView("Restoring browser")
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
      restorationError = (error as? LocalizedError)?.errorDescription ?? "The page could not be restored."
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
        ProgressView().controlSize(.small)
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

    do {
      let (data, response) = try await URLSession.shared.data(for: request)
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
        HStack(spacing: 6) {
          Image(systemName: "brain")
          Text("Thought")
          Spacer()
          Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
        }
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      if isExpanded, let text = component.payload["text"] ?? component.payload["content"] {
        Text(text)
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .lineSpacing(3)
          .textSelection(.enabled)
      }
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
  }
}

struct ToolMessageComponent: View {
  let component: MessageComponent
  @State private var isExpanded = false

  private var name: String { component.payload["name"] ?? "tool" }
  private var status: String { component.payload["status"] ?? "running" }
  private var output: String? { component.payload["output"] ?? component.payload["result"] }
  private var error: String? { component.payload["error"] }

  var body: some View {
    DisclosureGroup(isExpanded: $isExpanded) {
      VStack(alignment: .leading, spacing: 8) {
        if let output { detailBlock(title: "Output", text: output) }
        if let error { detailBlock(title: "Error", text: error) }
      }
      .padding(.top, 6)
    } label: {
      HStack(spacing: 8) {
        Text("$")
        Text(name)
        Spacer(minLength: 8)
        statusLabel
      }
      .font(.system(size: 12, weight: .medium, design: .monospaced))
      .foregroundStyle(ChiefTheme.secondary)
      .contentShape(Rectangle())
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    .tint(ChiefTheme.secondary)
  }

  @ViewBuilder
  private var statusLabel: some View {
    switch status {
    case "running", "working":
      Label("Running", systemImage: "ellipsis")
        .foregroundStyle(ChiefTheme.secondary)
    case "failed", "error":
      Label("Error", systemImage: "xmark.circle")
        .foregroundStyle(.red)
    default:
      Label("Done", systemImage: "checkmark.circle")
        .foregroundStyle(ChiefTheme.secondary)
    }
  }

  private func detailBlock(title: String, text: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(ChiefTheme.tertiary)
      Text(text)
        .font(.system(size: 12, design: .monospaced))
        .foregroundStyle(ChiefTheme.secondary)
        .textSelection(.enabled)
        .lineLimit(6)
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

private struct ActionRequestMessageComponent: View {
  let component: MessageComponent
  let onSelect: (String) -> Void
  @State private var selectedOption: String?

  var body: some View {
    ChiefCard {
      VStack(alignment: .leading, spacing: 12) {
        Label("Requires attention", systemImage: "exclamationmark.circle")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(ChiefTheme.accent)
        Text(component.payload["title"] ?? "Choose an option")
          .font(.system(size: 16, weight: .semibold))
        ForEach(options, id: \.self) { option in
          Button {
            selectedOption = option
            onSelect(option)
          } label: {
            HStack {
              AgentMark(name: "Chief", size: 24)
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
        }
      }
    }
    .padding(.top, 4)
  }

  private var options: [String] {
    component.payload["options"]?.split(separator: "|").map(String.init) ?? []
  }
}
