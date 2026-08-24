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
  private static var operationLabels: [String: String] = [:]
  static let presentation = AgentBrowserPresentationStore()

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

  /// Starts (or resumes) the exact agent-conversation browser and pins a new
  /// session above the composer. A user's later inline/PiP choice is retained
  /// across subsequent tool calls in the same browser lifecycle.
  static func engage(for scope: String, operationLabel: String) -> WebKitBrowserDriver {
    let browser = driver(for: scope)
    let startsNewLifecycle: Bool
    switch browser.phase {
    case .connecting, .connected:
      startsNewLifecycle = browser.scope != scope
    case .idle, .failed:
      startsNewLifecycle = true
    }
    if startsNewLifecycle {
      browser.begin(scope: scope)
    }
    if startsNewLifecycle {
      browser.setDisplayMode(.pictureInPicture)
    }
    operationLabels[scope] = sanitizedOperationLabel(operationLabel)
    presentation.invalidate()
    return browser
  }

  /// A WebKit navigation temporarily moves through `.connecting`; that is
  /// still the same visible browser lifecycle. Removing the surface in that
  /// phase causes the page, operating shader, and status pill to flash out.
  static func shouldPresent(
    _ browser: WebKitBrowserDriver,
    for scope: String,
    placement: BrowserDisplayMode
  ) -> Bool {
    browser.scope == scope
      && browser.phase != .idle
      && browser.displayMode == placement
  }

  static func operationLabel(for scope: String) -> String? {
    operationLabels[scope]
  }

  /// BrowserUI requires the selected host to change before SwiftUI moves the
  /// shared WKWebView. This keeps inline and PiP from briefly competing for it.
  static func setDisplayMode(_ mode: BrowserDisplayMode, for scope: String) {
    guard mode != .fullscreen, let browser = drivers[scope] else { return }
    browser.setDisplayMode(mode)
    presentation.invalidate()
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

  private static func sanitizedOperationLabel(_ raw: String) -> String {
    let compact = raw
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    let bounded = String(compact.prefix(48))
    return bounded.isEmpty ? "Browsing" : bounded
  }
}

@MainActor
final class AgentBrowserPresentationStore: ObservableObject {
  @Published private(set) var revision = 0

  func invalidate() {
    revision &+= 1
  }
}

extension ToolContext {
  var browserScope: String { "\(workspaceID):\(agentID):\(conversationID)" }
}
