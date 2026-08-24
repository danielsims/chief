import Foundation
import CryptoKit

/// Builds NIP-98 HTTP Authorization headers for relay requests.
///
/// An ephemeral `kind 27235` event is signed with secp256k1 (BIP-340) over its
/// SHA-256 id. The event carries `u` (absolute request URL), `method`, a SHA-256
/// `payload` tag binding the request body, and a request tag to keep events unique.
/// It is sent as `Authorization: Nostr <base64(event)>`.
struct NIP98Signer {
  let identity: NostrIdentity

  /// Produce the `Authorization` header value for a request.
  func header(method: String, url: URL, body: Data) throws -> String {
    let payloadHash = SHA256.hash(data: body).map {
      String(format: "%02x", $0)
    }.joined()

    var tags: [[String]] = [
      ["u", url.absoluteString],
      ["method", method.uppercased()],
    ]
    if !body.isEmpty {
      tags.append(["payload", payloadHash])
    }
    tags.append(["request", UUID().uuidString.lowercased()])

    let createdAt = Int(Date().timeIntervalSince1970)
    // NIP-01 defines the event id as the SHA-256 of this exact six-element
    // array. Signing the wire object instead is not Nostr-compatible and does
    // not let a verifier prove that the request tags were signed.
    let serialized = try JSONSerialization.data(
      withJSONObject: [0, identity.publicKeyHex, createdAt, 27235, tags, ""],
      options: [.withoutEscapingSlashes]
    )
    let idBytes = SHA256.hash(data: serialized)
    let id = idBytes.map { String(format: "%02x", $0) }.joined()
    // BIP-340 signs the 32-byte message directly (the event id).
    let sigBytes = try identity.schnorrSign(message: Data(idBytes))
    let sig = sigBytes.map { String(format: "%02x", $0) }.joined()

    let full: [String: Any] = [
      "id": id,
      "pubkey": identity.publicKeyHex,
      "content": "",
      "kind": 27235,
      "created_at": createdAt,
      "tags": tags,
      "sig": sig,
    ]
    let json = try JSONSerialization.data(withJSONObject: full)
    return "Nostr \(json.base64EncodedString())"
  }

}
