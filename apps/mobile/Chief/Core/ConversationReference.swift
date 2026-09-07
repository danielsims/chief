import Foundation

extension WorkspaceSnapshot {
  func conversationID(for reference: String) -> String? {
    if let exact = conversations.first(where: { $0.id == reference }) { return exact.id }
    let name = reference.hasPrefix("#") ? String(reference.dropFirst()) : reference
    return conversations.first {
      $0.kind == .channel && $0.name.caseInsensitiveCompare(name) == .orderedSame
    }?.id
  }
}
