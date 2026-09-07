import SwiftUI

struct WorkspaceSettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let workspaceID: String
  @State private var settings: WorkspaceSettingsData?
  @State private var saving = false
  @State private var error: String?
  @State private var saved = false
  @State private var inviteSheet = false
  @State private var deleteSheet = false
  @State private var confirmation = ""

  var body: some View {
    List {
      if settings != nil {
        Section {
          ProfilePhotoPicker(imageURL: settings?.imageURL) { data in
            if let data {
              settings?.imageURL = try await model.relay.uploadIdentityImage(workspaceID: workspaceID, data: data)
            } else { settings?.imageURL = nil }
            saved = false
          }
          TextField("Workspace name", text: field(\.name))
          TextField("Website", text: field(\.website))
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        } header: { Text("Workspace").textCase(nil) }
        Section {
          Button(saving ? "Saving…" : "Save changes") { Task { await save() } }
            .disabled(saving || settings?.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false)
          if saved { Text("Changes saved").foregroundStyle(ChiefTheme.secondary) }
          if let error { Text(error).font(.footnote).foregroundStyle(.red) }
        }
        Section {
          Button("Invite people") { inviteSheet = true }
        } header: { Text("Members").textCase(nil) }
        Section {
          Button("Delete workspace", role: .destructive) { confirmation = ""; deleteSheet = true }
        }
      } else if let error {
        Text(error).foregroundStyle(ChiefTheme.secondary)
        Button("Try again") { Task { await load() } }
      } else { ProgressView() }
    }
    .disabled(saving)
    .scrollContentBackground(.hidden)
    .background(ChiefTheme.background)
    .navigationTitle("Workspace settings")
    .navigationBarTitleDisplayMode(.inline)
    .task { await load() }
    .sheet(isPresented: $inviteSheet) { InvitePeopleSheet() }
    .alert("Delete workspace?", isPresented: $deleteSheet) {
      TextField("Workspace name", text: $confirmation)
      Button("Cancel", role: .cancel) {}
      Button("Delete permanently", role: .destructive) {
        Task {
          saving = true
          do {
            try await model.relay.deleteWorkspace(workspaceID: workspaceID)
            dismiss()
            await model.hydrateWorkspace()
          } catch { self.error = "Couldn’t delete the workspace. Try again." }
          saving = false
        }
      }.disabled(confirmation != settings?.name)
    } message: { Text("This deletes all workspace data. Type \(settings?.name ?? "the workspace name") to confirm.") }
  }

  private func field(_ key: WritableKeyPath<WorkspaceSettingsData, String>) -> Binding<String> {
    Binding(get: { settings?[keyPath: key] ?? "" }, set: { settings?[keyPath: key] = $0; saved = false })
  }

  private func load() async {
    error = nil
    do { settings = try await model.relay.workspaceSettings(workspaceID: workspaceID) }
    catch { self.error = "Workspace settings are available to the owner." }
  }

  private func save() async {
    guard var settings else { return }
    settings.name = settings.name.trimmingCharacters(in: .whitespacesAndNewlines)
    settings.website = settings.website.trimmingCharacters(in: .whitespacesAndNewlines)
    if !settings.website.isEmpty && !settings.website.contains("://") { settings.website = "https://" + settings.website }
    saving = true
    error = nil
    do {
      try await model.relay.saveWorkspaceSettings(workspaceID: workspaceID, settings: settings)
      self.settings = settings
      saved = true
      await model.hydrateWorkspace()
    } catch { self.error = "Couldn’t save changes. Check the details and try again." }
    saving = false
  }
}
