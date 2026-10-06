import Foundation

/// A person's role in a workspace, mirroring desktop's `organization-role`.
enum WorkspaceRole: String, Sendable {
  case owner, admin, member

  init(_ value: String) {
    self = WorkspaceRole(rawValue: value) ?? .member
  }

  /// Owners and admins manage people, invitations, and webhooks.
  var canManage: Bool { self != .member }
  var title: String { rawValue.capitalized }
}

extension AppModel {
  /// The signed-in person's role in the active workspace, or nil when the
  /// relay can't say. Pages fall back to read-only until this resolves.
  func currentWorkspaceRole() async -> WorkspaceRole? {
    guard let workspaceID = workspace?.id,
      let members = try? await relay.workspaceMembers(workspaceID: workspaceID),
      workspace?.id == workspaceID
    else { return nil }
    return workspaceRole(in: members)
  }

  func workspaceRole(in members: [WorkspaceMember]) -> WorkspaceRole? {
    guard let userID = session?.user.id else { return nil }
    return members.first { $0.isPerson && $0.principalId == userID }.map { WorkspaceRole($0.role) }
  }

  var isChiefCloudRelay: Bool {
    RelayDirectoryStore.sameOrigin(appConfiguration.relayURL, AppConfiguration.chiefCloud().relayURL)
  }
}

enum SettingsFailure {
  /// Settings copy for a relay failure. Relay status errors describe workspace
  /// setup, so pages supply their own fallback for anything else.
  static func message(_ error: Error, fallback: String) -> String {
    switch error {
    case RelayError.httpStatus(403):
      "Only workspace owners and admins can do this."
    case RelayError.unavailable, RelayError.unauthorized, RelayError.capacity:
      error.localizedDescription
    case let error as OrganizationInvitationError:
      error.localizedDescription
    default:
      fallback
    }
  }
}

enum SettingsFormat {
  static func date(_ date: Date) -> String {
    date.formatted(.dateTime.month(.abbreviated).day())
  }

  static func dateTime(_ date: Date) -> String {
    date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
  }

  static func isoDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    return ISO8601DateFormatter.chief().date(from: value)
      ?? ISO8601DateFormatter.noFraction().date(from: value)
  }
}
