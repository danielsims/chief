import SwiftUI

struct WorkspaceInviteConfirmationSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      if let preview = model.workspaceInvitePreview {
        WorkspaceIdentityAvatar(
          name: preview.workspaceName,
          website: preview.website,
          imageURL: nil,
          size: 56
        )

        VStack(alignment: .leading, spacing: 7) {
          Text("Join \(preview.workspaceName)?")
            .font(.system(size: 25, weight: .semibold, design: .rounded))
          Text(inviteDescription(preview))
            .font(.system(size: 15))
            .foregroundStyle(ChiefTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }

        if let host = model.pendingWorkspaceInvite?.relayURL.host {
          Label(host, systemImage: "network")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(ChiefTheme.secondary)
        }

        if let error = model.workspaceInviteError {
          Text(error)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.red.opacity(0.9))
        }

        Spacer(minLength: 0)

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
            if model.workspaceInviteInProgress { ProgressView().tint(.black) }
            else { Text("Join workspace") }
          }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(model.workspaceInviteInProgress)
      }
    }
    .padding(ChiefTheme.pagePadding)
    .background(ChiefSheetPalette.background.ignoresSafeArea())
    .presentationDragIndicator(.visible)
  }

  private func inviteDescription(_ preview: WorkspaceInvite) -> String {
    if let channel = preview.conversationName {
      return "You were invited to the \(channel) channel in this workspace."
    }
    return "You were invited to collaborate in this workspace."
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
            if model.workspaceInvitePreview != nil { dismiss() }
          }
        } label: {
          Group {
            if model.workspaceInviteInProgress { ProgressView().tint(.black) }
            else { Text("Continue") }
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

struct InvitePeopleSheet: View {
  @Environment(AppModel.self) private var model
  @State private var link: WorkspaceInviteLink?
  @State private var loading = true

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      VStack(alignment: .leading, spacing: 6) {
        Text("Invite people")
          .font(.system(size: 24, weight: .semibold, design: .rounded))
        Text("This single-use link expires in seven days.")
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
      }

      if loading {
        ProgressView().tint(.white)
          .frame(maxWidth: .infinity, minHeight: 100)
      } else if let link {
        Text(link.url.absoluteString)
          .font(.system(size: 13, design: .monospaced))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(3)
          .textSelection(.enabled)
          .padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 14))

        ShareLink(item: link.url) {
          Label("Share invitation", systemImage: "square.and.arrow.up")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(PrimaryButtonStyle())
        .simultaneousGesture(TapGesture().onEnded { Haptics.heavy() })
      } else {
        Text(model.workspaceInviteError ?? "Chief couldn’t create an invitation.")
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
      }
      Spacer()
    }
    .padding(ChiefTheme.pagePadding)
    .background(ChiefSheetPalette.background.ignoresSafeArea())
    .task {
      link = await model.createWorkspaceInvite()
      loading = false
    }
    .chiefSheet([.height(390), .large])
  }
}
