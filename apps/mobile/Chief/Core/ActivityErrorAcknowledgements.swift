import Foundation

struct ActivityErrorAcknowledgements {
  private var dates: [String: Double]
  private let defaults: UserDefaults
  private let storageKey = "chief.activity-errors.read.v1"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    dates = defaults.dictionary(forKey: storageKey) as? [String: Double] ?? [:]
  }

  private func key(userID: String, workspaceID: String, conversationID: String) -> String {
    [userID, workspaceID, conversationID].map { "\($0.utf8.count):\($0)" }.joined()
  }

  func contains(_ date: Date, userID: String, workspaceID: String, conversationID: String) -> Bool {
    let local = dates[key(userID: userID, workspaceID: workspaceID, conversationID: conversationID)] ?? 0
    let workspace = dates[key(userID: userID, workspaceID: workspaceID, conversationID: "mission-control")] ?? 0
    return date.timeIntervalSince1970 <= max(local, workspace)
  }

  mutating func acknowledge(userID: String, workspaceID: String, conversationID: String, at date: Date = .now) {
    dates[key(userID: userID, workspaceID: workspaceID, conversationID: conversationID)] = date.timeIntervalSince1970
    defaults.set(dates, forKey: storageKey)
  }
}
