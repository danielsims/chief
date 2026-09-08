import Foundation

enum MessageSendRecovery {
  static func restoredDraft(pending: String, current: String) -> String {
    guard !current.isEmpty else { return pending }
    guard !pending.isEmpty else { return current }
    return pending + "\n" + current
  }
}
