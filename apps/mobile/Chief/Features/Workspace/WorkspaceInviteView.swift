import SwiftUI

struct WorkspaceInviteRelayConfirmationSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      Image(systemName: "network")
        .font(.system(size: 22, weight: .medium))
        .frame(width: 48, height: 48)
        .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 14))

      VStack(alignment: .leading, spacing: 7) {
        Text("Join this workspace?")
          .font(.system(size: 25, weight: .semibold, design: .rounded))
        Text(
          "This invitation is hosted on a different Chief relay. Check the host before you continue."
        )
        .font(.system(size: 15))
        .foregroundStyle(ChiefTheme.secondary)
        .fixedSize(horizontal: false, vertical: true)
      }

      if let host = model.pendingInviteRelayURL?.host {
        Text(host)
          .font(.system(size: 13, weight: .medium, design: .monospaced))
          .foregroundStyle(ChiefTheme.accent)
          .padding(.horizontal, 13)
          .frame(height: 40)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 12))
      }

      Text(
        "Chief will verify this relay and ask you to sign in there if this device has not connected before. Your other workspaces stay signed in."
      )
      .font(.system(size: 13))
      .foregroundStyle(ChiefTheme.secondary)
      .fixedSize(horizontal: false, vertical: true)

      if let error = model.workspaceInviteError {
        Text(error)
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(.red.opacity(0.9))
      }

      Spacer(minLength: 0)

      Button {
        Haptics.heavy()
        Task { await model.confirmPendingInviteRelay() }
      } label: {
        Group {
          if model.workspaceInviteInProgress {
            ChiefSpinner().tint(ChiefTheme.onPrimary)
          } else {
            Text("Continue")
          }
        }
      }
      .buttonStyle(PrimaryButtonStyle())
      .disabled(model.workspaceInviteInProgress)
    }
    .padding(ChiefTheme.pagePadding)
    .background(ChiefSheetPalette.background.ignoresSafeArea())
    .presentationDragIndicator(.visible)
  }
}

struct WorkspaceInviteConfirmationSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(spacing: 0) {
      if let preview = model.workspaceInvitePreview {
        WorkspaceIdentityAvatar(
          name: preview.workspaceName,
          website: preview.website,
          imageURL: nil,
          size: 64
        )

        Text("Join \(preview.workspaceName)")
          .font(.system(size: 26, weight: .semibold, design: .rounded))
          .multilineTextAlignment(.center)
          .padding(.top, 20)

        Text(inviteDescription(preview))
          .font(.system(size: 15))
          .foregroundStyle(ChiefTheme.secondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 8)

        if let error = model.workspaceInviteError {
          Text(error)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.red.opacity(0.9))
            .multilineTextAlignment(.center)
            .padding(.top, 14)
        }

        Spacer(minLength: 24)

        Button {
          Haptics.heavy()
          Task {
            if await model.claimPendingWorkspaceInvite() {
              Haptics.success()
              dismiss()
            } else {
              Haptics.error()
            }
          }
        } label: {
          Group {
            if model.workspaceInviteInProgress {
              ChiefSpinner().tint(ChiefTheme.onPrimary)
            } else {
              Text("Join workspace")
            }
          }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(model.workspaceInviteInProgress)

        if let host = model.pendingWorkspaceInvite?.relayURL.host {
          Text("Hosted on \(host)")
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.tertiary)
            .padding(.top, 12)
        }
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, ChiefTheme.pagePadding)
    .padding(.top, 36)
    .padding(.bottom, 12)
    .background(ChiefSheetPalette.background.ignoresSafeArea())
    .presentationDetents([.height(370)])
    .presentationDragIndicator(.visible)
  }

  private func inviteDescription(_ preview: WorkspaceInvite) -> String {
    if let channel = preview.conversationName {
      return "You’ve been invited to #\(channel) on Chief."
    }
    return "You’ve been invited to collaborate on Chief."
  }
}

struct JoinWorkspaceSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var value = ""

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 18) {
        VStack(alignment: .leading, spacing: 6) {
          Text("Join a workspace")
            .font(.system(size: 24, weight: .semibold, design: .rounded))
          Text("Paste the invitation link someone shared with you.")
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.secondary)
        }

        TextField("https://…/invite/…", text: $value, axis: .vertical)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .textFieldStyle(ChiefTextFieldStyle())

        if let error = model.workspaceInviteError {
          Text(error)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.red.opacity(0.9))
        }

        Spacer()

        Button {
          Haptics.heavy()
          Task {
            await model.prepareWorkspaceInvite(from: value)
            if model.workspaceInvitePreview != nil
              || model.workspaceInviteNeedsRelayConfirmation
            {
              dismiss()
            }
          }
        } label: {
          Group {
            if model.workspaceInviteInProgress {
              ChiefSpinner().tint(ChiefTheme.onPrimary)
            } else {
              Text("Continue")
            }
          }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      .padding(ChiefTheme.pagePadding)
      .background(ChiefSheetPalette.background.ignoresSafeArea())
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Cancel") { dismiss() }
        }
      }
    }
    .chiefSheet([.height(390), .large])
  }
}

/// Invite someone by email with a role, or hand out a link that expires in
/// seven days. Mirrors desktop's invitations card.
struct InvitePeopleSheet: View {
  enum Role: String, CaseIterable, Identifiable {
    case member, admin
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var detail: String {
      switch self {
      case .member: "Works in channels with your agents."
      case .admin: "Can also manage people, invitations and webhooks."
      }
    }
  }

  @Environment(AppModel.self) private var model
  @FocusState private var emailFocused: Bool
  var onInvited: () async -> Void = {}
  @State private var email = ""
  @State private var role = Role.member
  @State private var sending = false
  @State private var sentTo: String?
  @State private var emailError: String?
  @State private var link: WorkspaceInviteLink?
  @State private var creatingLink = false
  @State private var linkError: String?
  @State private var copied = false

  var body: some View {
    VStack(spacing: 0) {
      ChiefSheetHeader(title: "Invite people")
      ScrollView {
        VStack(alignment: .leading, spacing: 26) {
          identity
          emailForm
          linkSection
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 28)
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .chiefSheet([.large])
    .onAppear { emailFocused = true }
  }

  private var identity: some View {
    HStack(spacing: 14) {
      WorkspaceIdentityAvatar(
        name: model.workspace?.name ?? "Chief",
        website: model.workspace?.website,
        imageURL: model.workspace?.imageURL,
        size: 48
      )
      VStack(alignment: .leading, spacing: 3) {
        Text(model.workspace?.name ?? "Your workspace")
          .font(.system(size: 20, weight: .semibold, design: .rounded))
          .lineLimit(1)
        Text("They receive an email and join once they accept it.")
          .font(.system(size: 13))
          .foregroundStyle(ChiefSheetPalette.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var emailForm: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        Image(systemName: "envelope")
          .font(.system(size: 15))
          .foregroundStyle(ChiefSheetPalette.secondary)
        TextField("teammate@company.com", text: $email)
          .font(.system(size: 16))
          .textInputAutocapitalization(.never)
          .keyboardType(.emailAddress)
          .textContentType(.emailAddress)
          .autocorrectionDisabled()
          .submitLabel(.send)
          .focused($emailFocused)
          .onSubmit { Task { await send() } }
          .accessibilityLabel("Email")
      }
      .padding(.horizontal, 15)
      .frame(height: 52)
      .background(ChiefSheetPalette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .onChange(of: email) {
        sentTo = nil
        emailError = nil
      }

      Picker("Role", selection: $role) {
        ForEach(Role.allCases) { Text($0.title).tag($0) }
      }
      .pickerStyle(.segmented)
      .onChange(of: role) { Haptics.selection() }

      Text(role.detail)
        .font(.system(size: 12))
        .foregroundStyle(ChiefSheetPalette.secondary)
        .padding(.horizontal, 2)

      Button {
        Haptics.heavy()
        Task { await send() }
      } label: {
        Group {
          if sending {
            ChiefSpinner().tint(ChiefTheme.onPrimary)
          } else {
            Text("Send invite")
          }
        }
      }
      .buttonStyle(PrimaryButtonStyle())
      .disabled(sending || trimmedEmail.isEmpty)
      .padding(.top, 4)

      if let sentTo {
        SettingsNote(text: "Invitation sent to \(sentTo).", tone: .success)
      } else if let emailError {
        SettingsNote(text: emailError, tone: .failure)
      }
    }
  }

  private var linkSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        Rectangle().fill(ChiefSheetPalette.separator).frame(height: 0.5)
        Text("or share a link")
          .font(.system(size: 12))
          .foregroundStyle(ChiefSheetPalette.secondary)
          .fixedSize()
        Rectangle().fill(ChiefSheetPalette.separator).frame(height: 0.5)
      }
      .padding(.bottom, 4)

      if let link {
        HStack(spacing: 10) {
          Image(systemName: "link")
            .font(.system(size: 14))
            .foregroundStyle(ChiefSheetPalette.secondary)
          Text(link.url.absoluteString)
            .font(.system(size: 13, design: .monospaced))
            .foregroundStyle(ChiefSheetPalette.primary)
            .lineLimit(1)
            .truncationMode(.middle)
            .textSelection(.enabled)
          Spacer(minLength: 4)
          Button {
            UIPasteboard.general.url = link.url
            copied = true
            Haptics.light()
          } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
              .font(.system(size: 14, weight: .medium))
              .frame(width: 36, height: 36)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityLabel(copied ? "Invite link copied" : "Copy invite link")
        }
        .padding(.leading, 15)
        .padding(.trailing, 6)
        .frame(height: 52)
        .background(
          ChiefSheetPalette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

        ShareLink(item: link.url) {
          Label("Share invite link", systemImage: "square.and.arrow.up")
        }
        .buttonStyle(SecondarySheetButtonStyle())
        .simultaneousGesture(TapGesture().onEnded { Haptics.heavy() })
      } else {
        Button {
          Haptics.medium()
          Task { await createLink() }
        } label: {
          Group {
            if creatingLink {
              ChiefSpinner()
            } else {
              Label("Create invite link", systemImage: "link")
            }
          }
        }
        .buttonStyle(SecondarySheetButtonStyle())
        .disabled(creatingLink)
      }

      Text(linkError ?? (link == nil ? "Works for one person and expires in 7 days." : "Copy it now. This link won’t be shown again."))
        .font(.system(size: 12))
        .foregroundStyle(linkError == nil ? ChiefSheetPalette.secondary : .red.opacity(0.9))
        .padding(.horizontal, 2)
    }
  }

  private var trimmedEmail: String {
    email.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func send() async {
    guard !sending, !trimmedEmail.isEmpty else { return }
    sending = true
    emailError = nil
    defer { sending = false }
    do {
      let address = trimmedEmail.lowercased()
      try await model.inviteWorkspaceMember(email: address, role: role.rawValue)
      Haptics.success()
      email = ""
      sentTo = address
      await onInvited()
    } catch {
      Haptics.error()
      emailError = SettingsFailure.message(
        error, fallback: "Chief couldn’t send this invitation. Check the address and try again.")
    }
  }

  private func createLink() async {
    guard !creatingLink else { return }
    creatingLink = true
    linkError = nil
    defer { creatingLink = false }
    if let created = await model.createWorkspaceInvite() {
      link = created
      UIPasteboard.general.url = created.url
      copied = true
      Haptics.success()
    } else {
      linkError = "Chief couldn’t create an invite link. Try again."
      Haptics.error()
    }
  }
}

/// The quieter companion to `PrimaryButtonStyle` on sheet surfaces.
struct SecondarySheetButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 15, weight: .semibold))
      .frame(maxWidth: .infinity)
      .frame(height: 50)
      .foregroundStyle(ChiefSheetPalette.primary.opacity(isEnabled ? 1 : 0.4))
      .background(
        ChiefSheetPalette.surface.opacity(configuration.isPressed ? 0.6 : 1),
        in: RoundedRectangle(cornerRadius: 13, style: .continuous)
      )
  }
}
