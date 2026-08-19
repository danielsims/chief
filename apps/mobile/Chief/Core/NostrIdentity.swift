import Foundation
import P256K
import Security

/// A secp256k1 (BIP-340 / Nostr) identity. The public key is the relay identity
/// and the private key signs NIP-98 request events. The raw 32-byte secret is
/// held in the Keychain and never leaves the device.
struct NostrIdentity: Equatable, Sendable {
  let privateKeyHex: String
  let publicKeyHex: String

  static func generate() throws -> NostrIdentity {
    let privateKey = try P256K.Schnorr.PrivateKey()
    let privateHex = privateKey.dataRepresentation.toHex()
    let publicHex = privateKey.xonly.bytes.toHex()
    return NostrIdentity(privateKeyHex: privateHex, publicKeyHex: publicHex)
  }

  static func from(privateKeyHex: String) throws -> NostrIdentity {
    guard let bytes = Data(hex: privateKeyHex) else {
      throw NostrIdentityError.invalidKey
    }
    let privateKey = try P256K.Schnorr.PrivateKey(
      dataRepresentation: bytes
    )
    let publicHex = privateKey.xonly.bytes.toHex()
    return NostrIdentity(
      privateKeyHex: privateKeyHex.lowercased(),
      publicKeyHex: publicHex
    )
  }

  /// Sign a 32-byte message (the NIP-98 event id) with BIP-340 Schnorr.
  func schnorrSign(message: Data) throws -> Data {
    guard let keyBytes = Data(hex: privateKeyHex) else {
      throw NostrIdentityError.invalidKey
    }
    let privateKey = try P256K.Schnorr.PrivateKey(
      dataRepresentation: keyBytes
    )
    var messageRef = [UInt8](message)
    let signature = try privateKey.signature(
      message: &messageRef,
      auxiliaryRand: nil,
      strict: true
    )
    return signature.dataRepresentation
  }
}

private extension Sequence where Element == UInt8 {
  func toHex() -> String {
    map { String(format: "%02x", $0) }.joined()
  }
}

enum NostrIdentityError: Error {
  case invalidKey
}

/// Persists a NostrIdentity in the Keychain under a service/account name.
struct NostrKeychainStore {
  private let service: String
  private let account: String

  init(service: String = "sh.heychief.mobile.identity", account: String = "active") {
    self.service = service
    self.account = account
  }

  func load() throws -> NostrIdentity? {
    var query = self.query(returningData: true)
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data,
      let hex = String(data: data, encoding: .utf8), !hex.isEmpty
    else { throw KeychainError(status) }
    return try NostrIdentity.from(privateKeyHex: hex)
  }

  func save(_ identity: NostrIdentity) throws {
    SecItemDelete(query(returningData: false) as CFDictionary)
    var values = query(returningData: false)
    values[kSecValueData as String] = Data(identity.privateKeyHex.utf8)
    values[kSecAttrAccessible as String] =
      kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(values as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainError(status) }
  }

  func clear() throws {
    let status = SecItemDelete(query(returningData: false) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError(status)
    }
  }

  private func query(returningData: Bool) -> [String: Any] {
    var value: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    if returningData {
      value[kSecReturnData as String] = true
      value[kSecMatchLimit as String] = kSecMatchLimitOne
    }
    return value
  }
}

extension Data {
  init?(hex: String) {
    let cleaned = hex.replacingOccurrences(of: " ", with: "")
    guard cleaned.count % 2 == 0, cleaned.allSatisfy({ $0.isHexDigit }) else {
      return nil
    }
    var bytes = [UInt8]()
    bytes.reserveCapacity(cleaned.count / 2)
    var index = cleaned.startIndex
    while index < cleaned.endIndex {
      let next = cleaned.index(index, offsetBy: 2)
      guard let byte = UInt8(cleaned[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    self = Data(bytes)
  }
}
