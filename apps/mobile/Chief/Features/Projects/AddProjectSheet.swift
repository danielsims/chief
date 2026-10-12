import SwiftUI

/// Connecting source control, as on desktop: a repository hosted on the
/// workspace's relay, or a GitHub repository by link. A private GitHub
/// repository needs GitHub connected first, which happens on GitHub itself.
struct AddProjectSheet: View {
  private enum Source: Hashable { case chiefGit, github }

  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var path: [Source]
  @State private var name = ""
  @State private var remoteURL: String
  @State private var busy = false
  @State private var message: String?

  init(initialRemoteURL: String = "") {
    _remoteURL = State(initialValue: initialRemoteURL)
    _path = State(initialValue: initialRemoteURL.isEmpty ? [] : [.github])
  }

  var body: some View {
    NavigationStack(path: $path) {
      Form {
        Section {
          NavigationLink(value: Source.chiefGit) {
            Label {
              Text("Continue with Chief Git Relay")
            } icon: {
              Image("ChiefMark").resizable().scaledToFit().frame(width: 20, height: 20)
            }
          }
          NavigationLink(value: Source.github) {
            Label {
              Text("Continue with GitHub")
            } icon: {
              Image("Plugin-github-com").resizable().scaledToFit().frame(width: 20, height: 20)
            }
          }
        } footer: {
          Text("Choose where your agents' repositories live.")
        }
      }
      .navigationTitle("Connect source control")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
      .navigationDestination(for: Source.self) { source in
        switch source {
        case .chiefGit:
          step(
            title: "Create a repository", footer: "Chief hosts it on your relay.",
            action: "Create", ready: !name.trimmingCharacters(in: .whitespaces).isEmpty,
            perform: createChiefGit
          ) {
            TextField("Repository name", text: $name)
          }
        case .github:
          step(
            title: "Add a GitHub repository",
            footer: "Paste a GitHub link for your agents to work in.",
            action: "Connect", ready: githubRepository != nil, perform: connectGitHub
          ) {
            TextField("https://github.com/owner/repository", text: $remoteURL)
              .keyboardType(.URL)
          }
        }
      }
    }
  }

  private func step<Field: View>(
    title: String, footer: String, action: String, ready: Bool,
    perform: @escaping () async throws -> Void,
    @ViewBuilder field: () -> Field
  ) -> some View {
    Form {
      Section {
        field()
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      } footer: {
        Text(message ?? footer)
      }
    }
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
    .onDisappear { message = nil }
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button(action) {
          busy = true
          message = nil
          Task {
            do { try await perform() } catch { message = error.localizedDescription }
            busy = false
          }
        }
        .disabled(busy || !ready)
      }
    }
    .overlay { if busy { ChiefSpinner().controlSize(.regular) } }
  }

  /// `owner/name` for a github.com link.
  private var githubRepository: String? {
    guard let url = URL(string: remoteURL.trimmingCharacters(in: .whitespaces)),
      url.host?.replacingOccurrences(of: "www.", with: "") == "github.com"
    else { return nil }
    let parts = url.deletingPathExtension().pathComponents.filter { $0 != "/" }
    return parts.count >= 2 ? "\(parts[0])/\(parts[1])" : nil
  }

  private func createChiefGit() async throws {
    guard let workspaceID = model.workspace?.id else { return }
    _ = try await model.relay.createWorkspaceGitRepository(workspaceID: workspaceID, name: name)
    await model.hydrateWorkspace()
    dismiss()
  }

  private func connectGitHub() async throws {
    guard let workspaceID = model.workspace?.id, let repository = githubRepository else { return }
    let connection = try await model.relay.githubConnection(workspaceID: workspaceID)
    // Public repositories, and any once GitHub is connected, add straight away.
    if connection.installations.isEmpty, await !isPublic(repository) {
      guard connection.canManage else {
        message = "A workspace owner needs to connect GitHub first."
        return
      }
      guard connection.app != nil else {
        message = "Set up GitHub from Chief on your computer first."
        return
      }
      openURL(try await model.relay.githubInstallURL(workspaceID: workspaceID))
      message = "Share \(repository) on GitHub, then tap Connect again."
      return
    }
    _ = try await model.relay.createProject(
      workspaceID: workspaceID,
      name: String(repository.split(separator: "/")[1]),
      remoteURL: "https://github.com/\(repository).git",
      providerID: "github"
    )
    await model.hydrateWorkspace()
    dismiss()
  }

  private func isPublic(_ repository: String) async -> Bool {
    struct Repository: Decodable { let `private`: Bool }
    guard let url = URL(string: "https://api.github.com/repos/\(repository)"),
      let (data, response) = try? await URLSession.shared.data(from: url),
      (response as? HTTPURLResponse)?.statusCode == 200,
      let decoded = try? JSONDecoder().decode(Repository.self, from: data)
    else { return false }
    return !decoded.private
  }
}
