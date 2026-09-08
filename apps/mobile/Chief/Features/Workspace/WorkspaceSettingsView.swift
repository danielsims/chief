import SwiftUI

struct WorkspaceSettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let workspaceID: String
  @State private var settings: WorkspaceSettingsData?
  @State private var original: WorkspaceSettingsData?
  @State private var uploadingPhoto = false
  @State private var saving = false
  @State private var error: String?
  @State private var saved = false
  @State private var inviteSheet = false
  @State private var deleteSheet = false
  @State private var confirmation = ""

  var body: some View {
    SettingsPage {
      if let current = settings {
        HStack(spacing: 16) {
          ProfilePhotoPicker(imageURL: current.imageURL, name: current.name) { data in
            uploadingPhoto = true
            defer { uploadingPhoto = false }
            if let data {
              settings?.imageURL = try await model.relay.uploadIdentityImage(
                workspaceID: workspaceID, data: data)
            } else {
              settings?.imageURL = nil
            }
            saved = false
          }
          VStack(alignment: .leading, spacing: 5) {
            Text(original?.name ?? current.name)
              .font(.system(size: 22, weight: .regular, design: .rounded))
            Text("Workspace").font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
          }
        }
        SettingsSection(title: "Details") {
          SettingsTextField(title: "Name", text: field(\.name))
          SettingsTextField(title: "Website", text: field(\.website), keyboard: .URL)
        }
        SettingsSection(title: "People") {
          Button {
            inviteSheet = true
          } label: {
            SettingsDestination(title: "Invite people", icon: "person.badge.plus")
          }.buttonStyle(.plain)
        }
        if let error { Text(error).font(.system(size: 13)).foregroundStyle(.red) }
        Button("Delete workspace", role: .destructive) {
          confirmation = ""
          deleteSheet = true
        }
        .font(.system(size: 14))
        .padding(.vertical, 12)
      } else if let error {
        Text(error).foregroundStyle(ChiefTheme.secondary)
        Button("Try again") { Task { await load() } }
      } else {
        ProgressView().frame(maxWidth: .infinity)
      }
    }
    .disabled(saving)
    .navigationTitle("Workspace settings")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if saving {
          ProgressView().controlSize(.small)
        } else {
          Button(saved ? "Saved" : "Save") { Task { await save() } }
            .font(.system(size: 15, weight: .medium))
            .disabled(
              uploadingPhoto || settings == original
                || settings?.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false)
        }
      }
    }
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
      }.disabled(confirmation != original?.name)
    } message: {
      Text(
        "This deletes all workspace data. Type \(original?.name ?? "the workspace name") to confirm."
      )
    }
  }

  private func field(_ key: WritableKeyPath<WorkspaceSettingsData, String>) -> Binding<String> {
    Binding(
      get: { settings?[keyPath: key] ?? "" },
      set: {
        settings?[keyPath: key] = $0
        saved = false
      })
  }

  private func load() async {
    error = nil
    do {
      settings = try await model.relay.workspaceSettings(workspaceID: workspaceID)
      original = settings
    } catch RelayError.httpStatus(403) {
      self.error = "Only the workspace owner can manage settings."
    } catch { self.error = "Couldn’t load workspace settings." }
  }

  private func save() async {
    guard var settings else { return }
    settings.name = settings.name.trimmingCharacters(in: .whitespacesAndNewlines)
    settings.website = settings.website.trimmingCharacters(in: .whitespacesAndNewlines)
    if !settings.website.isEmpty && !settings.website.contains("://") {
      settings.website = "https://" + settings.website
    }
    saving = true
    error = nil
    do {
      try await model.relay.saveWorkspaceSettings(workspaceID: workspaceID, settings: settings)
      self.settings = settings
      original = settings
      saved = true
      await model.hydrateWorkspace()
    } catch { self.error = "Couldn’t save changes. Check the details and try again." }
    saving = false
  }
}
