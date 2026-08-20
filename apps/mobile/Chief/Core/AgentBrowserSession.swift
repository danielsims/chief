import BrowserUI
import BrowserUIWebKit
import CryptoKit
import Foundation
import SwiftUI
import UIKit

/// Owns one isolated WebKit driver for each agent conversation. The driver,
/// cookie store and cursor never cross workspace, agent or conversation scope.
@MainActor
enum AgentBrowserSession {
  private static var drivers: [String: WebKitBrowserDriver] = [:]
  private static var snapshottedURLs: [String: Set<String>] = [:]

  static func driver(for scope: String) -> WebKitBrowserDriver {
    if let driver = drivers[scope] { return driver }
    let driver = WebKitBrowserDriver(
      configuration: WebKitBrowserDriverConfiguration(
        dataStore: .persistentSession(stableIdentifier(for: scope)),
        postLoadSettleDelay: 1.5,
        allowsNavigation: BrowserURLPolicy.allows
      )
    )
    drivers[scope] = driver
    return driver
  }

  static func existingDriver(for scope: String) -> WebKitBrowserDriver? {
    drivers[scope]
  }

  static func beginTurn(for scope: String) {
    snapshottedURLs[scope] = []
  }

  static func recordSnapshot(for scope: String, url: String) {
    guard let canonical = canonicalEvidenceURL(url) else { return }
    snapshottedURLs[scope, default: []].insert(canonical)
  }

  static func hasSnapshotEvidence(for scope: String, url: String) -> Bool {
    guard let canonical = canonicalEvidenceURL(url) else { return false }
    return snapshottedURLs[scope]?.contains(canonical) == true
  }

  static let clientInstanceID =
    UIDevice.current.identifierForVendor?.uuidString ?? "chief-ios-device"

  nonisolated static func redactedURL(_ raw: String) -> String {
    WebKitBrowserDriver.redactedURLForModel(raw)
  }

  nonisolated static func canonicalEvidenceURL(_ raw: String) -> String? {
    let redacted = WebKitBrowserDriver.redactedURLForModel(raw)
    guard redacted != "[invalid URL]",
      var components = URLComponents(string: redacted),
      components.scheme?.lowercased() == "https",
      let host = components.host?.lowercased()
    else { return nil }
    components.scheme = "https"
    components.host = host
    components.path = components.path.isEmpty ? "/" : components.path
    components.query = nil
    components.fragment = nil
    return components.string
  }

  private static func stableIdentifier(for scope: String) -> UUID {
    var bytes = Array(SHA256.hash(data: Data(scope.utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0F) | 0x50
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    return UUID(uuid: (
      bytes[0], bytes[1], bytes[2], bytes[3],
      bytes[4], bytes[5], bytes[6], bytes[7],
      bytes[8], bytes[9], bytes[10], bytes[11],
      bytes[12], bytes[13], bytes[14], bytes[15]
    ))
  }
}

extension ToolContext {
  var browserScope: String { "\(workspaceID):\(agentID):\(conversationID)" }
}
