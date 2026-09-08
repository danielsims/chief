import SwiftUI

struct AddProjectSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var remoteURL: String
  @State private var busy = false
  @State private var errorMessage: String?

  init(initialRemoteURL: String = "") {
    _remoteURL = State(initialValue: initialRemoteURL)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("https://github.com/org/repo.git", text: $remoteURL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.URL)
        } header: {
          Text("Git URL")
        } footer: {
          Text("Clone this repository into the workspace.")
        }
        if let errorMessage {
          Section {
            Text(errorMessage).foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Connect a repository")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Connect") { connect() }
            .disabled(busy || URL(string: remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)) == nil)
        }
      }
      .overlay {
        if busy { ProgressView().controlSize(.regular) }
      }
    }
  }

  private func connect() {
    let value = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: value), let workspaceID = model.workspace?.id else { return }
    busy = true
    errorMessage = nil
    Task {
      do {
        _ = try await model.relay.createProject(
          workspaceID: workspaceID,
          name: repositoryName(from: url),
          remoteURL: url.absoluteString,
          providerID: gitProvider(from: url)
        )
        await model.hydrateWorkspace()
        dismiss()
      } catch {
        errorMessage = error.localizedDescription
        busy = false
      }
    }
  }
}

func gitProvider(from url: URL) -> String {
  switch url.host?.replacingOccurrences(of: "www.", with: "") {
  case "github.com": "github"
  case "gitlab.com": "gitlab"
  case "bitbucket.org": "bitbucket"
  default: "generic-git"
  }
}

func repositoryName(from url: URL) -> String {
  let last = url.deletingPathExtension().lastPathComponent
  return last.isEmpty ? "Repository" : last
}
