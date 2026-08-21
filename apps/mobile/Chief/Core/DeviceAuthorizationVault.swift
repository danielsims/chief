import Foundation

/// Process-local proof that Better Auth enrolled this device's NIP-98 key.
/// The proof is deliberately not persisted: every fresh app process binds once,
/// while normal relay traffic verifies locally without a database or cell read.
actor DeviceAuthorizationVault {
  static let shared = DeviceAuthorizationVault()

  private var value: String?

  func store(_ authorization: String) {
    value = authorization
  }

  func load() -> String? {
    value
  }

  func clear() {
    value = nil
  }
}
