import Foundation

/// Builds NIP-98 `Authorization: Nostr <base64(event)>` headers, signing with an
/// identity loaded from the Keychain. Shared by the HTTP relay client and the
/// live socket client.
enum NIP98Authenticator {
  /// Produce the Authorization header for a request, signing with the given
  /// identity (falls back to the device user identity).
  static func header(
    identity: NostrIdentity? = nil,
    method: String,
    url: URL,
    body: Data = Data()
  ) throws -> String {
    let resolved = identity ?? (try? NostrKeychainStore().load())
    guard let resolved else {
      throw NIP98Error.noIdentity
    }
    return try NIP98Signer(identity: resolved)
      .header(method: method, url: url, body: body)
  }
}

enum NIP98Error: Error {
  case noIdentity
}
