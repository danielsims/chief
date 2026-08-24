import Foundation
import Security

/// A per-agent secp256k1 identity, held separately from the human's. Every agent
/// in the roster gets its OWN identity in its OWN Keychain slot, registered with
/// the workspace as itself (`agent_keys`), so the relay always attributes its
/// messages to the agent rather than the user or Chief.
struct AgentIdentityStore {
  static let service = "sh.heychief.mobile.agent-identity"
  let workspaceID: String
  let agentID: String

  init(workspaceID: String, agentID: String = "chief") {
    self.workspaceID = workspaceID
    self.agentID = agentID
  }

  private var keychain: NostrKeychainStore {
    NostrKeychainStore.forService(
      service: Self.service,
      account: "\(workspaceID):\(agentID)",
      accessibility: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    )
  }

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
  static func forService(
    service: String,
    account: String,
    accessibility: CFString = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  ) -> NostrKeychainStore {
    NostrKeychainStore(
      service: service,
      account: account,
      accessibility: accessibility
    )
  }
}
