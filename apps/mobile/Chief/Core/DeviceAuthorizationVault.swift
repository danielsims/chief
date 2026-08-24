import Foundation

/// Process-local proof that Better Auth enrolled this device's NIP-98 key.
/// The proof is deliberately not persisted: every fresh app process binds once,
/// while normal relay traffic verifies locally without a database or cell read.
actor DeviceAuthorizationVault {
  static let shared = DeviceAuthorizationVault()

  private var values: [String: String] = [:]

  func store(_ authorization: String, for relayURL: URL) {
    values[Self.key(relayURL)] = authorization
  }

  func load(for relayURL: URL) -> String? {
    values[Self.key(relayURL)]
  }

  func clear(for relayURL: URL? = nil) {
    if let relayURL { values.removeValue(forKey: Self.key(relayURL)) } else { values.removeAll() }
  }

  private static func key(_ relayURL: URL) -> String {
    "\(relayURL.scheme?.lowercased() ?? "")://\(relayURL.host?.lowercased() ?? ""):\(relayURL.port ?? -1)"
  }
}
