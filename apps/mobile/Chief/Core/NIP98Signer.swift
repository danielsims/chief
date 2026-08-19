import Foundation
import CryptoKit

/// Builds NIP-98 HTTP Authorization headers for relay requests.
///
/// An ephemeral `kind 27235` event is signed with secp256k1 (BIP-340) over its
/// SHA-256 id. The event carries `u` (absolute request URL), `method`, a SHA-256
/// `payload` tag binding the request body, and a `nonce` to keep events unique.
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
    tags.append(["nonce", UUID().uuidString.lowercased()])

    let createdAt = Int(Date().timeIntervalSince1970)
    let event: [String: Any] = [
      "pubkey": identity.publicKeyHex,
      "content": "",
      "kind": 27235,
      "created_at": createdAt,
      "tags": tags,
    ]

    // The event id is the SHA-256 of the JSON-serialized event (without id/sig).
    let serialized = try serializeEvent(event)
    let idBytes = SHA256.hash(data: Data(serialized.utf8))
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

  /// Serialize the event fields in deterministic order (no id/sig yet).
  /// Swift dictionaries are unordered, so build the canonical JSON manually.
  private func serializeEvent(_ event: [String: Any]) throws -> String {
    let pubkey = event["pubkey"] as! String
    let content = event["content"] as! String
    let kind = event["kind"] as! Int
    let createdAt = event["created_at"] as! Int
    let tags = event["tags"] as! [[String]]
    let tagsJSON = tags.map { tag -> String in
      let parts = tag.map { escapedJSON($0) }.joined(separator: ",")
      return "[\(parts)]"
    }.joined(separator: ",")
    return #"{"pubkey":"\#(pubkey)","content":"\#(content)","kind":\#(kind),"created_at":\#(createdAt),"tags":[\#(tagsJSON)]}"#
  }

  private func escapedJSON(_ value: String) -> String {
    let escaped = value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
  }
}
