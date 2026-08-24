import Foundation

/// Local, tenant-scoped read cursors. The relay remains authoritative for
/// messages; this file stores only timestamps and never copies message content.
struct ConversationReadState: Codable, Equatable, Sendable {
  var version = 1
  var contexts: [String: Date] = [:]

  static func channelKey(_ conversationID: String) -> String {
    "channel:\(conversationID)"
  }

  static func threadKey(_ conversationID: String, rootMessageID: String) -> String {
    "thread:\(conversationID):\(rootMessageID)"
  }

  mutating func advance(_ context: String, to date: Date) -> Bool {
    guard (contexts[context] ?? .distantPast) < date else { return false }
    contexts[context] = date
    return true
  }

  func isUnread(
    createdAt: Date,
    conversationID: String,
    threadRootID: String?
  ) -> Bool {
    let channelReadAt = contexts[Self.channelKey(conversationID)]
    guard let threadRootID else {
      return channelReadAt == nil || createdAt > channelReadAt!
    }
    let threadReadAt = contexts[
      Self.threadKey(conversationID, rootMessageID: threadRootID)
    ]
    let effectiveReadAt = [channelReadAt, threadReadAt].compactMap { $0 }.max()
    return effectiveReadAt == nil || createdAt > effectiveReadAt!
  }
}

/// UserDefaults is appropriate for read cursors: they are non-secret UI state,
/// survive relaunches, and are namespaced by both workspace and reader so one
/// tenant can never clear or inherit another tenant's unread state.
// UserDefaults serializes access internally. Swift's SDK annotation has not
// yet adopted Sendable, so this wrapper is the single audited boundary rather
// than leaking unchecked conformance into the rest of the read-state model.
struct ConversationReadStateStore: @unchecked Sendable {
  private let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  func load(workspaceID: String, readerID: String) -> ConversationReadState {
    guard
      let data = defaults.data(forKey: storageKey(workspaceID: workspaceID, readerID: readerID)),
      let state = try? JSONDecoder().decode(ConversationReadState.self, from: data),
      state.version == 1
    else { return ConversationReadState() }
    return state
  }

  func save(_ state: ConversationReadState, workspaceID: String, readerID: String) {
    guard let data = try? JSONEncoder().encode(state) else { return }
    defaults.set(data, forKey: storageKey(workspaceID: workspaceID, readerID: readerID))
  }

  private func storageKey(workspaceID: String, readerID: String) -> String {
    "chief.conversation-read-state.v1.\(workspaceID).\(readerID)"
  }
}
