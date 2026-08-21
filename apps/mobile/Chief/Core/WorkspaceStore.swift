import Foundation

protocol WorkspaceStore: Sendable {
  func load() throws -> WorkspaceSnapshot?
  func save(_ workspace: WorkspaceSnapshot) throws
  func clear() throws
}

struct FileWorkspaceStore: WorkspaceStore {
  private var fileURL: URL {
    let applicationSupport = try! FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    return applicationSupport
      .appending(path: "Chief", directoryHint: .isDirectory)
      .appending(path: "workspace.json")
  }

  func load() throws -> WorkspaceSnapshot? {
    guard FileManager.default.fileExists(atPath: fileURL.path()) else { return nil }
    return try JSONDecoder().decode(
      WorkspaceSnapshot.self,
      from: Data(contentsOf: fileURL)
    )
  }

  func save(_ workspace: WorkspaceSnapshot) throws {
    let directory = fileURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    try JSONEncoder().encode(workspace).write(
      to: fileURL,
      options: [.atomic, .completeFileProtection]
    )
  }

  func clear() throws {
    guard FileManager.default.fileExists(atPath: fileURL.path()) else { return }
    try FileManager.default.removeItem(at: fileURL)
  }
}

extension WorkspaceSnapshot {
  static func local(from draft: OnboardingDraft) -> WorkspaceSnapshot {
    WorkspaceSnapshot(
      id: "local-\(UUID().uuidString.lowercased())",
      name: draft.companyName.trimmingCharacters(in: .whitespacesAndNewlines),
      website: draft.website.trimmingCharacters(in: .whitespacesAndNewlines),
      selectedApps: draft.selectedApps.sorted(),
      onboardingComplete: true,
      conversations: [
        ConversationSummary(
          id: "general",
          name: "general",
          kind: .channel,
          isPrivate: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: "Your workspace is ready."
        )
      ],
      agents: [
        AgentSummary(id: "chief", name: "Chief", role: "Chief of staff", status: .idle)
      ],
      projects: []
    )
  }
}
