#if DEBUG
import Foundation

struct DevCodexBridgeConnection: Equatable, Sendable {
  static let defaultModel = "gpt-5.6-luna"

  let endpoint: URL
  let capabilityToken: String
  let model: String

  init(url: URL) throws {
    guard
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.scheme?.lowercased() == "chief-mobile",
      components.host?.lowercased() == "connect-codex"
    else { throw DevCodexBridgeError.invalidLink }
    var values: [String: String] = [:]
    for item in components.queryItems ?? []
    where ["endpoint", "token", "model"].contains(item.name) {
      guard values[item.name] == nil, let value = item.value else {
        throw DevCodexBridgeError.invalidLink
      }
      values[item.name] = value
    }
    guard let rawEndpoint = values["endpoint"],
      let endpoint = URL(string: rawEndpoint),
      endpoint.scheme?.lowercased() == "wss",
      endpoint.user == nil,
      endpoint.password == nil,
      let token = values["token"],
      token.range(of: #"^[0-9a-fA-F]{64}$"#, options: .regularExpression) != nil
    else { throw DevCodexBridgeError.invalidLink }
    let model = values["model"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !model.isEmpty else { throw DevCodexBridgeError.invalidLink }
    self.endpoint = endpoint
    capabilityToken = token
    self.model = model
  }
}

enum DevCodexBridgeSettings {
  private static let endpointKey = "chief.dev.codex-bridge.endpoint"
  private static let modelKey = "chief.dev.codex-bridge.model"
  private static let workspaceIDsKey = "chief.dev.codex-bridge.workspaces"

  static var endpoint: URL? {
    UserDefaults.standard.string(forKey: endpointKey).flatMap(URL.init(string:))
  }

  static var model: String {
    UserDefaults.standard.string(forKey: modelKey)
      ?? DevCodexBridgeConnection.defaultModel
  }

  static var isConfigured: Bool { endpoint != nil }

  static func save(_ connection: DevCodexBridgeConnection) {
    UserDefaults.standard.set(connection.endpoint.absoluteString, forKey: endpointKey)
    UserDefaults.standard.set(connection.model, forKey: modelKey)
  }

  /// The development bridge is an explicit, workspace-local transport choice.
  /// Keeping this association prevents a stale global debug setting from
  /// silently hijacking setup or agent turns in unrelated workspaces.
  static func isEnabled(for workspaceID: String) -> Bool {
    enabledWorkspaceIDs.contains(workspaceID)
  }

  static func setEnabled(_ enabled: Bool, for workspaceID: String) {
    var workspaceIDs = enabledWorkspaceIDs
    if enabled {
      workspaceIDs.insert(workspaceID)
    } else {
      workspaceIDs.remove(workspaceID)
    }
    UserDefaults.standard.set(workspaceIDs.sorted(), forKey: workspaceIDsKey)
  }

  private static var enabledWorkspaceIDs: Set<String> {
    Set(UserDefaults.standard.stringArray(forKey: workspaceIDsKey) ?? [])
  }
}

enum DevCodexBridgeError: LocalizedError {
  case invalidLink
  case notConnected
  case connection(String)
  case invalidResponse(String)

  var errorDescription: String? {
    switch self {
    case .invalidLink:
      "This development Codex connection link is invalid. Restart the Mac bridge and scan its QR code again."
    case .notConnected:
      "Connect this debug build to the Codex bridge running on your Mac."
    case .connection(let message):
      "The development Codex bridge could not be reached: \(message)"
    case .invalidResponse(let message):
      "The development Codex bridge returned an invalid response: \(message)"
    }
  }
}
#endif
