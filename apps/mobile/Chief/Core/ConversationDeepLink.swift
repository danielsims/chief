import Foundation

struct SelectedThread: Equatable, Sendable {
  var conversationID: String
  var rootMessageID: String
}

/// Destination for a lock-screen or in-app notification tap. Opens the matching
/// workspace conversation, and a thread when the payload includes a root id.
struct ConversationDeepLink: Equatable, Sendable {
  var workspaceID: String
  var conversationID: String
  var threadRootID: String?

  var url: URL {
    var components = URLComponents()
    components.scheme = "chief-mobile"
    components.host = "conversation"
    var items = [
      URLQueryItem(name: "workspace", value: workspaceID),
      URLQueryItem(name: "channel", value: conversationID),
    ]
    if let threadRootID, !threadRootID.isEmpty {
      items.append(URLQueryItem(name: "thread", value: threadRootID))
    }
    components.queryItems = items
    return components.url!
  }

  init(workspaceID: String, conversationID: String, threadRootID: String? = nil) {
    self.workspaceID = workspaceID
    self.conversationID = conversationID
    self.threadRootID =
      threadRootID?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
  }

  init?(url: URL) {
    guard ["chief-mobile", "chief"].contains(url.scheme?.lowercased() ?? "") else {
      return nil
    }
    let host = url.host?.lowercased() ?? ""
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func query(_ name: String) -> String? {
      items.first { $0.name == name }?.value?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .nilIfEmpty
    }
    guard host == "conversation" else { return nil }
    guard
      let workspaceID = query("workspace"),
      let conversationID = query("channel") ?? query("conversation")
    else { return nil }
    self.init(
      workspaceID: workspaceID,
      conversationID: conversationID,
      threadRootID: query("thread") ?? query("threadRootId")
    )
  }

  init?(userInfo: [AnyHashable: Any]) {
    if let urlString = Self.string(userInfo, keys: ["url", "deepLinkUrl", "deepLinkURL"]),
      let url = URL(string: urlString),
      let parsed = ConversationDeepLink(url: url)
    {
      self = parsed
      return
    }
    guard
      let workspaceID = Self.string(userInfo, keys: ["workspaceID", "workspaceId"]),
      let conversationID = Self.string(
        userInfo,
        keys: ["conversationID", "conversationId", "channelID", "channelId"]
      )
    else { return nil }
    self.init(
      workspaceID: workspaceID,
      conversationID: conversationID,
      threadRootID: Self.string(userInfo, keys: ["threadRootID", "threadRootId", "thread"])
    )
  }

  private static func string(_ userInfo: [AnyHashable: Any], keys: [String]) -> String? {
    for key in keys {
      if let value = userInfo[key] as? String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
      }
    }
    return nil
  }
}

extension String {
  fileprivate var nilIfEmpty: String? { isEmpty ? nil : self }
}
