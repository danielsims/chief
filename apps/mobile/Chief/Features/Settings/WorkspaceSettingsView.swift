import SwiftUI

/// Workspace details, members, invitations and deletion. Owners edit the
/// details; owners and admins manage people; only owners delete.
struct WorkspaceSettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var loaded = false
  @State private var role: WorkspaceRole?
  @State private var members: [WorkspaceMember] = []
  @State private var invitations: [WorkspaceInvitation] = []
  @State private var inviteLinks: [WorkspaceOpenInvite] = []
  @State private var membersError: String?
  @State private var invitationsError: String?
  @State private var settings: WorkspaceSettingsData?
  @State private var original: WorkspaceSettingsData?
  @State private var saving = false
  @State private var saveState: SaveState = .idle
  @State private var busyID: String?
  @State private var actionError: String?
  @State private var removing: WorkspaceMember?
  @State private var revokingInvitation: WorkspaceInvitation?
  @State private var revokingLink: WorkspaceOpenInvite?
  @State private var inviting = false
  @State private var confirmingDelete = false
  @State private var deleteConfirmation = ""
  @State private var deleting = false
  @State private var deleteError: String?

  private enum SaveState { case idle, saved, failed }

  var body: some View {
    SettingsPage(
      intro: "The company your agents work for. They use the name and website as context."
    ) {
      if !loaded {
        SettingsLoading()
      } else {
        details
        membersSection
        if role?.canManage == true { invitationsSection }
        if role == .owner { deleteSection }
      }
    }
    .navigationTitle("Workspace")
    .toolbar {
      if role == .owner, settings != nil {
        ToolbarItem(placement: .topBarTrailing) {
          if saving {
            ChiefSpinner().controlSize(.small)
          } else {
            Button(saveState == .saved && settings == original ? "Saved" : "Save") {
              Task { await save() }
            }
            .font(.system(size: 15, weight: .medium))
            .disabled(!canSave)
          }
        }
      }
    }
    .task(id: model.workspace?.id) { await load() }
    .refreshable { await load() }
    .sheet(isPresented: $inviting) {
      InvitePeopleSheet { await loadDirectory() }
    }
    .confirmationDialog(
      "Remove \(removing?.name ?? "this member")?",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        if let member = removing { Task { await remove(member) } }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("They lose access to \(workspaceName) and its channels.")
    }
    .confirmationDialog(
      "Revoke this invitation?",
      isPresented: Binding(
        get: { revokingInvitation != nil }, set: { if !$0 { revokingInvitation = nil } }),
      titleVisibility: .visible
    ) {
      Button("Revoke", role: .destructive) {
        if let invitation = revokingInvitation { Task { await cancel(invitation) } }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("\(revokingInvitation?.email ?? "They") won’t be able to join with this invitation.")
    }
    .confirmationDialog(
      "Revoke this invite link?",
      isPresented: Binding(get: { revokingLink != nil }, set: { if !$0 { revokingLink = nil } }),
      titleVisibility: .visible
    ) {
      Button("Revoke", role: .destructive) {
        if let link = revokingLink { Task { await revoke(link) } }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Nobody will be able to join with this link. It can’t be used again.")
    }
    .alert("Delete \(workspaceName)", isPresented: $confirmingDelete) {
      TextField(workspaceName, text: $deleteConfirmation)
      Button("Cancel", role: .cancel) {}
      Button("Delete permanently", role: .destructive) { Task { await deleteWorkspace() } }
        .disabled(deleteConfirmation != workspaceName)
    } message: {
      Text("This deletes the workspace and all of its data. Type the workspace name to confirm.")
    }
  }

  // MARK: Sections

  @ViewBuilder private var details: some View {
    if role == .owner, let current = settings {
      HStack(spacing: 16) {
        ProfilePhotoPicker(
          imageURL: current.imageURL, name: current.name, workspaceWebsite: current.website,
          isWorkspace: true
        ) { data in
          try await saveLogo(data)
        }
        VStack(alignment: .leading, spacing: 4) {
          Text(original?.name ?? current.name)
            .font(.system(size: 22, weight: .regular, design: .rounded))
            .lineLimit(1)
          Text("Upload an image to override the website favicon.")
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      SettingsSection(title: "Details") {
        SettingsTextField(title: "Company name", text: field(\.name), placeholder: "Acme Inc")
        SettingsTextField(
          title: "Website URL", text: field(\.website), placeholder: "https://acme.com",
          keyboard: .URL)
        if saveState == .failed {
          SettingsNote(text: "Save failed. Check the details and try again.", tone: .failure)
        }
      }
    } else {
      HStack(spacing: 16) {
        WorkspaceIdentityAvatar(
          name: workspaceName, website: model.workspace?.website,
          imageURL: model.workspace?.imageURL, size: 64)
        VStack(alignment: .leading, spacing: 4) {
          Text(workspaceName)
            .font(.system(size: 22, weight: .regular, design: .rounded))
            .lineLimit(1)
          if let website = model.workspace?.website, !website.isEmpty {
            Text(website).font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
              .lineLimit(1)
          }
        }
      }
    }
  }

  private var membersSection: some View {
    SettingsSection(title: "Members", footer: "People with access to \(workspaceName).") {
      if let membersError {
        SettingsNote(text: membersError, tone: .failure)
      } else if people.isEmpty {
        Text("No members yet.").font(.system(size: 14)).foregroundStyle(ChiefTheme.secondary)
          .padding(.vertical, 12)
      } else {
        ForEach(people) { member in memberRow(member) }
      }
      if let actionError { SettingsNote(text: actionError, tone: .failure) }
    }
  }

  private func memberRow(_ member: WorkspaceMember) -> some View {
    SettingsRow {
      UserAvatar(
        user: ChiefUser(
          id: member.principalId, name: displayName(member),
          imageURL: model.relayAssetURL(member.image)),
        size: 34, rounded: true)
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(displayName(member)).foregroundStyle(ChiefTheme.accent).lineLimit(1)
          if isSelf(member) {
            Text("You").font(.system(size: 12)).foregroundStyle(ChiefTheme.tertiary)
          }
        }
        if let email = member.email, email != member.name {
          Text(email).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary).lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      if busyID == member.id {
        ChiefSpinner().controlSize(.small)
      } else if canEdit(member) {
        Menu {
          if role == .owner {
            Picker(
              "Role",
              selection: Binding(
                get: { member.role },
                set: { next in Task { await setRole(member, to: next) } }
              )
            ) {
              ForEach(["owner", "admin", "member"], id: \.self) { value in
                Text(WorkspaceRole(value).title).tag(value)
              }
            }
          }
          Button("Remove from workspace", systemImage: "person.badge.minus", role: .destructive) {
            removing = member
          }
        } label: {
          SettingsBadge(text: WorkspaceRole(member.role).title, showsMenuIndicator: true)
        }
        .accessibilityLabel("Manage \(displayName(member))")
      } else {
        SettingsBadge(text: WorkspaceRole(member.role).title)
      }
    }
  }

  private var invitationsSection: some View {
    SettingsSection(
      title: "Invitations",
      footer: "Invite people to \(workspaceName). They receive an email and join once they accept it."
    ) {
      SettingsActionRow(title: "Invite people", icon: "person.badge.plus") { inviting = true }
      if let invitationsError {
        SettingsNote(text: invitationsError, tone: .failure)
      }
      ForEach(pendingInvitations) { invitation in
        SettingsRow {
          Image(systemName: "envelope")
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.secondary)
            .frame(width: 34, height: 34)
            .background(
              ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 34 * 0.28, style: .continuous))
          VStack(alignment: .leading, spacing: 3) {
            Text(invitation.email).foregroundStyle(ChiefTheme.accent).lineLimit(1)
            Text(invitationDetail(invitation))
              .font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
          }
          Spacer(minLength: 8)
          if busyID == invitation.id {
            ChiefSpinner().controlSize(.small)
          } else {
            Menu {
              Button("Resend", systemImage: "arrow.clockwise") {
                Task { await resend(invitation) }
              }
              Button("Revoke invitation", systemImage: "xmark", role: .destructive) {
                revokingInvitation = invitation
              }
            } label: {
              Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(ChiefTheme.secondary)
                .frame(width: 34, height: 34)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Manage invitation for \(invitation.email)")
          }
        }
      }
      ForEach(inviteLinks) { link in
        SettingsRow {
          Image(systemName: "link")
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.secondary)
            .frame(width: 34, height: 34)
            .background(
              ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 34 * 0.28, style: .continuous))
          VStack(alignment: .leading, spacing: 3) {
            Text(link.label ?? "Invite link")
              .foregroundStyle(ChiefTheme.accent).lineLimit(1)
            Text(inviteLinkDetail(link))
              .font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
          }
          Spacer(minLength: 8)
          if busyID == link.id {
            ChiefSpinner().controlSize(.small)
          } else {
            Button("Revoke", role: .destructive) {
              revokingLink = link
            }
            .font(.system(size: 14, weight: .medium))
            .buttonStyle(.plain)
            .foregroundStyle(.red.opacity(0.9))
          }
        }
      }
    }
  }

  private var deleteSection: some View {
    SettingsSection(
      title: "Delete workspace",
      footer:
        "Permanently delete this workspace and all of its data. You’ll be moved to another workspace, or signed out if this is your last one."
    ) {
      SettingsActionRow(
        title: deleting ? "Deleting…" : "Delete workspace", icon: "trash", role: .destructive,
        isWorking: deleting
      ) {
        deleteConfirmation = ""
        deleteError = nil
        confirmingDelete = true
      }
      if let deleteError { SettingsNote(text: deleteError, tone: .failure) }
    }
  }

  // MARK: Derived state

  private var workspaceName: String { original?.name ?? model.workspace?.name ?? "this workspace" }

  private var people: [WorkspaceMember] {
    let order: [String: Int] = ["owner": 0, "admin": 1, "member": 2]
    return members.filter(\.isPerson).sorted {
      (order[$0.role] ?? 3, displayName($0).lowercased())
        < (order[$1.role] ?? 3, displayName($1).lowercased())
    }
  }

  private var pendingInvitations: [WorkspaceInvitation] {
    invitations.filter(\.isPending)
  }

  private var canSave: Bool {
    guard let settings else { return false }
    return settings != original
      && !settings.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func displayName(_ member: WorkspaceMember) -> String {
    member.name ?? member.email ?? "Member"
  }

  private func isSelf(_ member: WorkspaceMember) -> Bool {
    member.principalId == model.session?.user.id
  }

  private func canEdit(_ member: WorkspaceMember) -> Bool {
    role?.canManage == true && !isSelf(member)
  }

  private func inviteLinkDetail(_ link: WorkspaceOpenInvite) -> String {
    var parts = [link.conversationName.map { "#\($0)" } ?? "Link"]
    if let created = SettingsFormat.isoDate(link.createdAt) {
      parts.append("Created \(SettingsFormat.dateTime(created))")
    }
    if let expires = link.expiresDate { parts.append("Expires \(SettingsFormat.date(expires))") }
    return parts.joined(separator: " · ")
  }

  private func invitationDetail(_ invitation: WorkspaceInvitation) -> String {
    let role = WorkspaceRole(invitation.role).title
    guard let expires = invitation.expiresDate else { return role }
    return "\(role) · Expires \(SettingsFormat.date(expires))"
  }

  private func field(_ key: WritableKeyPath<WorkspaceSettingsData, String>) -> Binding<String> {
    Binding(
      get: { settings?[keyPath: key] ?? "" },
      set: {
        settings?[keyPath: key] = $0
        saveState = .idle
      })
  }

  // MARK: Loading

  private func load() async {
    await loadDirectory()
    if role == .owner, settings == nil, let workspaceID = model.workspace?.id {
      if let loadedSettings = try? await model.relay.workspaceSettings(workspaceID: workspaceID) {
        settings = loadedSettings
        original = loadedSettings
      }
    }
    loaded = true
  }

  /// Loads members and invitations together so the sections appear at once.
  private func loadDirectory() async {
    guard let workspaceID = model.workspace?.id else { return }
    do {
      members = try await model.relay.workspaceMembers(workspaceID: workspaceID)
      membersError = nil
      role = model.workspaceRole(in: members)
    } catch {
      membersError = SettingsFailure.message(
        error, fallback: "Chief couldn’t load this workspace’s members.")
    }
    guard role?.canManage == true else { return }
    do {
      invitations = try await model.relay.workspaceInvitations(workspaceID: workspaceID)
      inviteLinks = try await model.relay.workspaceInviteLinks(workspaceID: workspaceID)
      invitationsError = nil
    } catch {
      invitationsError = SettingsFailure.message(
        error, fallback: "Chief couldn’t load pending invitations.")
    }
  }

  // MARK: Actions

  private func save() async {
    guard var next = settings, let workspaceID = model.workspace?.id else { return }
    next.name = next.name.trimmingCharacters(in: .whitespacesAndNewlines)
    next.website = next.website.trimmingCharacters(in: .whitespacesAndNewlines)
    if !next.website.isEmpty && !next.website.contains("://") {
      next.website = "https://" + next.website
    }
    saving = true
    defer { saving = false }
    do {
      try await model.relay.saveWorkspaceSettings(workspaceID: workspaceID, settings: next)
      settings = next
      original = next
      saveState = .saved
      Haptics.success()
      await model.hydrateWorkspace()
    } catch {
      saveState = .failed
      Haptics.error()
    }
  }

  /// Logo changes save straight away, like desktop: an upload overrides the
  /// favicon and removing it falls back to the website icon.
  private func saveLogo(_ data: Data?) async throws {
    guard let workspaceID = model.workspace?.id, var saved = original else { return }
    saved.imageURL =
      if let data {
        try await model.relay.uploadIdentityImage(workspaceID: workspaceID, data: data)
      } else {
        nil
      }
    try await model.relay.saveWorkspaceSettings(workspaceID: workspaceID, settings: saved)
    original = saved
    settings?.imageURL = saved.imageURL
    await model.hydrateWorkspace()
  }

  private func setRole(_ member: WorkspaceMember, to next: String) async {
    guard next != member.role, let workspaceID = model.workspace?.id else { return }
    busyID = member.id
    actionError = nil
    defer { busyID = nil }
    do {
      try await model.relay.setWorkspaceMemberRole(
        workspaceID: workspaceID, kind: member.kind, principalID: member.principalId, role: next)
      Haptics.success()
      await loadDirectory()
    } catch RelayError.httpStatus(409) {
      actionError = "A workspace must keep at least one owner."
      Haptics.error()
    } catch {
      actionError = SettingsFailure.message(
        error, fallback: "Chief couldn’t change this member’s role.")
      Haptics.error()
    }
  }

  private func remove(_ member: WorkspaceMember) async {
    guard let workspaceID = model.workspace?.id else { return }
    removing = nil
    busyID = member.id
    actionError = nil
    defer { busyID = nil }
    do {
      try await model.relay.removeWorkspaceMember(
        workspaceID: workspaceID, kind: member.kind, principalID: member.principalId)
      Haptics.success()
      await loadDirectory()
    } catch RelayError.httpStatus(409) {
      actionError = "A workspace must keep at least one owner."
      Haptics.error()
    } catch {
      actionError = SettingsFailure.message(error, fallback: "Chief couldn’t remove this member.")
      Haptics.error()
    }
  }

  private func resend(_ invitation: WorkspaceInvitation) async {
    busyID = invitation.id
    invitationsError = nil
    defer { busyID = nil }
    do {
      try await model.inviteWorkspaceMember(email: invitation.email, role: invitation.role)
      Haptics.success()
      await loadDirectory()
    } catch {
      invitationsError = SettingsFailure.message(
        error, fallback: "Chief couldn’t resend this invitation.")
      Haptics.error()
    }
  }

  private func cancel(_ invitation: WorkspaceInvitation) async {
    guard let workspaceID = model.workspace?.id else { return }
    busyID = invitation.id
    invitationsError = nil
    defer { busyID = nil }
    do {
      try await model.relay.cancelWorkspaceInvitation(
        workspaceID: workspaceID, invitationID: invitation.id)
      Haptics.success()
      await loadDirectory()
    } catch {
      invitationsError = SettingsFailure.message(
        error, fallback: "Chief couldn’t cancel this invitation.")
      Haptics.error()
    }
  }

  private func revoke(_ link: WorkspaceOpenInvite) async {
    guard let workspaceID = model.workspace?.id else { return }
    busyID = link.id
    invitationsError = nil
    defer { busyID = nil }
    do {
      try await model.relay.revokeWorkspaceInvite(workspaceID: workspaceID, inviteID: link.inviteId)
      Haptics.success()
      await loadDirectory()
    } catch {
      invitationsError = SettingsFailure.message(
        error, fallback: "Chief couldn’t revoke this invite link.")
      Haptics.error()
    }
  }

  private func deleteWorkspace() async {
    guard let workspaceID = model.workspace?.id, deleteConfirmation == workspaceName else { return }
    deleting = true
    deleteError = nil
    defer { deleting = false }
    do {
      try await model.relay.deleteWorkspace(workspaceID: workspaceID)
      dismiss()
      await model.hydrateWorkspace()
    } catch {
      deleteError = SettingsFailure.message(error, fallback: "Chief couldn’t delete this workspace.")
      Haptics.error()
    }
  }
}
