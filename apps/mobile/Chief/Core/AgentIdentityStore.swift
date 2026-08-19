import Foundation

/// The on-device agent's own secp256k1 identity, held separately from the
/// human's. Registers with the workspace as `chief` and signs agent reply
/// messages so the relay attributes them to the agent rather than the user.
struct AgentIdentityStore {
  private let keychain = NostrKeychainStore.forService(
    service: "sh.heychief.mobile.agent-identity",
    account: "chief"
  )

  var agentID = "chief"

  func load() throws -> NostrIdentity? {
    try keychain.load()
  }

  /// Ensure an agent identity exists, generating a fresh key on first run.
  func ensure() throws -> NostrIdentity {
    if let existing = try load() { return existing }
    let identity = try NostrIdentity.generate()
    try keychain.save(identity)
    return identity
  }

  func clear() throws {
    try keychain.clear()
  }
}

extension NostrKeychainStore {
  static func forService(service: String, account: String) -> NostrKeychainStore {
    NostrKeychainStore(service: service, account: account)
  }
}
