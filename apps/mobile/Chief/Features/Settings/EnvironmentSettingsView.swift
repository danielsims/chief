import SwiftUI

/// Workspace secrets stored encrypted on the relay. Desktop keeps a separate
/// local vault for its own agent processes; on iPhone the relay's vault is the
/// one agents read. Only the owner can add, replace, or delete values.
struct EnvironmentSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var names: [String]?
  @State private var role: WorkspaceRole?
  @State private var error: String?
  @State private var query = ""
  @State private var editing: VariableEdit?
  @State private var deletingName: String?
  @State private var busyName: String?

  fileprivate struct VariableEdit: Identifiable {
    let name: String?
    var id: String { name ?? "new" }
  }

  var body: some View {
    SettingsPage(
      intro: "Credentials and configuration available to agents in this workspace."
    ) {
      if let names {
        HStack(spacing: 8) {
          Image(systemName: "magnifyingglass").foregroundStyle(ChiefTheme.secondary)
          TextField("Search variables", text: $query)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        .font(.system(size: 15))
        .padding(.horizontal, 13)
        .frame(height: 42)
        .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

        SettingsSection(
          title: "Environment variables",
          footer: "Values are encrypted on the relay and never shown again."
        ) {
          let visible = filtered(names)
          if visible.isEmpty {
            SettingsEmptyState(
              icon: "key",
              title: query.isEmpty ? "No environment variables yet" : "No matching variables",
              detail: query.isEmpty
                ? "Variables supplied during integration setup will appear here." : nil)
          } else {
            ForEach(visible, id: \.self) { name in variableRow(name) }
          }
          if let error { SettingsNote(text: error, tone: .failure) }
        }
      } else if let error {
        SettingsNote(text: error, tone: .failure)
      } else {
        SettingsLoading()
      }
    }
    .navigationTitle("Environment")
    .toolbar {
      if role == .owner {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Add environment variable", systemImage: "plus") {
            editing = VariableEdit(name: nil)
          }
        }
      }
    }
    .task(id: model.workspace?.id) { await load() }
    .refreshable { await load() }
    .sheet(item: $editing) { edit in
      VariableSheet(existingName: edit.name) { name, value in
        try await save(name: name, value: value)
      }
    }
    .confirmationDialog(
      "Delete \(deletingName ?? "this variable")?",
      isPresented: Binding(get: { deletingName != nil }, set: { if !$0 { deletingName = nil } }),
      titleVisibility: .visible
    ) {
      Button("Delete variable", role: .destructive) {
        if let name = deletingName { Task { await delete(name) } }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Agents and integrations in this workspace will no longer receive it.")
    }
  }

  private func variableRow(_ name: String) -> some View {
    SettingsRow {
      Image(systemName: "lock")
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 32, height: 32)
        .background(
          ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 32 * 0.28, style: .continuous))
      VStack(alignment: .leading, spacing: 3) {
        Text(name).font(.system(size: 14, weight: .medium, design: .monospaced))
          .foregroundStyle(ChiefTheme.accent).lineLimit(1)
        Text("••••••••••••").font(.system(size: 12, design: .monospaced))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      Spacer(minLength: 8)
      if busyName == name {
        ChiefSpinner().controlSize(.small)
      } else if role == .owner {
        Menu {
          Button("Replace value", systemImage: "arrow.triangle.2.circlepath") {
            editing = VariableEdit(name: name)
          }
          Button("Delete", systemImage: "trash", role: .destructive) { deletingName = name }
        } label: {
          Image(systemName: "ellipsis")
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(ChiefTheme.secondary)
            .frame(width: 34, height: 34)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Actions for \(name)")
      } else {
        SettingsBadge(text: "Sensitive")
      }
    }
  }

  private func filtered(_ names: [String]) -> [String] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    return names.filter { needle.isEmpty || $0.lowercased().contains(needle) }
  }

  /// Chief's own connection credentials are managed by their flows, not here.
  private static func isInternal(_ name: String) -> Bool {
    name == "vercel-deployment" || name.hasPrefix("external-agent.") || name.hasPrefix("github-")
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    async let nextRole = model.currentWorkspaceRole()
    do {
      names = try await model.relay.workspaceSecretNames(workspaceID: workspaceID)
        .filter { !Self.isInternal($0) }.sorted()
      error = nil
    } catch {
      self.error = SettingsFailure.message(error, fallback: "Chief couldn’t load variables.")
    }
    role = await nextRole
  }

  private func save(name: String, value: String) async throws {
    guard let workspaceID = model.workspace?.id else { return }
    try await model.relay.setWorkspaceSecret(workspaceID: workspaceID, name: name, value: value)
    editing = nil
    Haptics.success()
    await load()
  }

  private func delete(_ name: String) async {
    guard let workspaceID = model.workspace?.id else { return }
    deletingName = nil
    busyName = name
    defer { busyName = nil }
    do {
      try await model.relay.deleteWorkspaceSecret(workspaceID: workspaceID, name: name)
      Haptics.success()
      await load()
    } catch {
      self.error = SettingsFailure.message(error, fallback: "Chief couldn’t delete this variable.")
      Haptics.error()
    }
  }
}

private struct VariableSheet: View {
  let existingName: String?
  let onSave: (String, String) async throws -> Void
  @State private var name = ""
  @State private var value = ""
  @State private var busy = false
  @State private var error: String?

  /// Mirrors the relay's `secretNameSchema`.
  private static let pattern = /^[a-z][a-z0-9._-]{0,119}$/

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(
        title: existingName == nil ? "Add environment variable" : "Replace environment variable",
        doneTitle: "Cancel")
      VStack(alignment: .leading, spacing: 18) {
        Text("Stored encrypted on the relay. Values are never returned to the app or added to agent transcripts.")
          .font(.system(size: 14))
          .foregroundStyle(ChiefSheetPalette.secondary)
          .fixedSize(horizontal: false, vertical: true)
        if let existingName {
          SettingsValueRow(title: "Name", value: existingName, monospaced: true)
        } else {
          SettingsTextField(
            title: "Name", text: $name, placeholder: "api-token", monospaced: true,
            capitalization: .never)
          .onChange(of: name) { _, next in
            let cleaned = next.lowercased().filter { $0.isLetter || $0.isNumber || "._-".contains($0) }
            if cleaned != next { name = cleaned }
          }
        }
        SettingsTextField(
          title: "Value", text: $value,
          placeholder: existingName == nil ? "Enter a value" : "Enter a replacement value",
          secure: true)
        if let error { SettingsNote(text: error, tone: .failure) }
        Spacer(minLength: 0)
        Button {
          Haptics.heavy()
          Task { await submit() }
        } label: {
          if busy {
            ChiefSpinner().tint(.black)
          } else {
            Text(existingName == nil ? "Add variable" : "Replace")
          }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy || !valid)
      }
      .padding(.horizontal, 24)
      .padding(.bottom, 20)
    }
    .chiefSheet([.height(470)])
  }

  private var resolvedName: String { existingName ?? name }

  private var valid: Bool {
    resolvedName.wholeMatch(of: Self.pattern) != nil
      && !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func submit() async {
    guard valid else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await onSave(resolvedName, value.trimmingCharacters(in: .whitespacesAndNewlines))
    } catch {
      self.error = SettingsFailure.message(error, fallback: "Chief couldn’t save this variable.")
      Haptics.error()
    }
  }
}
