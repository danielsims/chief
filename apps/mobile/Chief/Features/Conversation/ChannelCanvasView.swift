import SwiftUI

struct ChannelCanvasView: View {
  @Environment(AppModel.self) private var model
  let conversationID: String
  @State private var files: [WorkspaceFileRecord] = []
  @State private var loading = true
  @State private var error: String?

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        if loading {
          ProgressView().frame(maxWidth: .infinity).padding(32)
        } else if let error {
          Text(error).foregroundStyle(ChiefTheme.secondary)
          Button("Try again") { Task { await load() } }
        } else if files.isEmpty {
          ContentUnavailableView(
            "No artifacts yet", systemImage: "doc.text",
            description: Text("Work saved by your team will appear here."))
        } else if let workspaceID = model.workspace?.id {
          ForEach(files) { file in
            ArtifactMessageComponent(
              message: ConversationMessage(
                id: file.id, workspaceID: workspaceID, conversationID: conversationID,
                threadRootID: nil, author: .system, body: "", components: [], createdAt: .now,
                sequence: 0),
              component: MessageComponent(
                id: file.id, kind: "artifact.reference",
                payload: [
                  "fileId": file.id, "conversationId": conversationID, "title": file.title,
                  "mimeType": file.mimeType, "version": String(file.version),
                ])
            )
          }
        }
      }.padding(ChiefTheme.pagePadding)
    }
    .background(ChiefTheme.background)
    .navigationTitle("Canvas")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: "\(model.workspace?.id ?? ""):\(conversationID)") { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    files = []
    loading = true
    error = nil
    do {
      let fetched = try await model.relay.listWorkspaceFiles(
        workspaceID: workspaceID, signingIdentity: nil)
      guard !Task.isCancelled, model.workspace?.id == workspaceID else { return }
      files = fetched.filter { $0.conversationId == conversationID }.sorted {
        $0.updatedAt > $1.updatedAt
      }
      loading = false
    } catch {
      guard !Task.isCancelled, model.workspace?.id == workspaceID else { return }
      self.error = "Could not load this channel's artifacts. Please try again."
      loading = false
    }
  }
}
