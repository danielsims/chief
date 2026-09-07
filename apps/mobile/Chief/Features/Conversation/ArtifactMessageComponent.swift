import SwiftUI
import WebKit

struct ArtifactMessageComponent: View {
  @Environment(AppModel.self) private var model
  let message: ConversationMessage
  let component: MessageComponent
  @State private var showing = false
  @State private var file: WorkspaceFileRecord?
  @State private var error: String?
  @State private var loadAttempt = 0

  var body: some View {
    Button {
      showing = true
    } label: {
      HStack(spacing: 12) {
        Image(systemName: "doc.text").foregroundStyle(.secondary)
        VStack(alignment: .leading, spacing: 4) {
          Text(component.payload["title"] ?? "Artifact").font(.system(size: 14, weight: .medium))
          Text("Open in Canvas").font(.system(size: 14)).foregroundStyle(.secondary)
        }
        Spacer()
        Image(systemName: "arrow.up.right").font(.system(size: 12)).foregroundStyle(.secondary)
      }.padding(14).background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(ChiefTheme.line, lineWidth: 0.5))
    }.buttonStyle(.plain)
      .sheet(isPresented: $showing) {
        NavigationStack {
          Group {
            if let file, model.workspace?.id == message.workspaceID {
              if file.mimeType == "text/html" {
                IsolatedArtifactHTML(content: file.content)
              } else {
                ScrollView {
                  MarkdownMessageBody(source: file.content, channelNames: []).padding(20).frame(
                    maxWidth: .infinity, alignment: .leading)
                }
              }
            } else if let error {
              VStack(spacing: 16) {
                Text(error).foregroundStyle(.secondary)
                Button("Try again") { loadAttempt += 1 }
              }.padding(24)
            } else {
              ProgressView()
            }
          }
          .navigationTitle(file?.title ?? "Canvas")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { showing = false } }
          }
          .task(id: "\(model.workspace?.id ?? ""):\(loadAttempt)") {
            file = nil
            error = nil
            guard model.workspace?.id == message.workspaceID,
              component.payload["conversationId"] == message.conversationID
            else {
              error = "This artifact is unavailable."
              return
            }
            do {
              let files = try await model.relay.listWorkspaceFiles(
                workspaceID: message.workspaceID, signingIdentity: nil)
              guard !Task.isCancelled else { return }
              file = files.first {
                $0.id == component.payload["fileId"] && $0.conversationId == message.conversationID
              }
              if file == nil { error = "This artifact is unavailable." }
            } catch { self.error = "Could not load this artifact. Please try again." }
          }
        }
      }
  }
}

private struct IsolatedArtifactHTML: UIViewRepresentable {
  let content: String
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = context.coordinator
    view.isOpaque = false
    return view
  }
  func updateUIView(_ view: WKWebView, context: Context) {
    guard context.coordinator.content != content else { return }
    context.coordinator.content = content
    let policy =
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    view.loadHTMLString(
      "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"\(policy)\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>:root{color-scheme:light dark}body{padding:20px;font:14px/1.6 system-ui}*{box-sizing:border-box}</style>\(content)",
      baseURL: nil)
  }
  final class Coordinator: NSObject, WKNavigationDelegate {
    var content: String?
    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
      decisionHandler(action.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
    }
  }
}
