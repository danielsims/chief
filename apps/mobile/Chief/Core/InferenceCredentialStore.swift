import Foundation
import Security

protocol InferenceCredentialStore: Sendable {
  func contains(_ provider: OnboardingDraft.InferenceProvider) -> Bool
  func load(_ provider: OnboardingDraft.InferenceProvider) throws -> String?
  func save(_ credential: String, for provider: OnboardingDraft.InferenceProvider) throws
  func clear(_ provider: OnboardingDraft.InferenceProvider) throws
}

struct KeychainInferenceCredentialStore: InferenceCredentialStore {
  private let service = "sh.heychief.mobile.inference"

  func contains(_ provider: OnboardingDraft.InferenceProvider) -> Bool {
    var result: CFTypeRef?
    var lookup = baseQuery(provider)
    lookup[kSecReturnAttributes as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    return SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess
  }

  func load(_ provider: OnboardingDraft.InferenceProvider) throws -> String? {
    var result: CFTypeRef?
    var lookup = baseQuery(provider)
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw KeychainError(status)
    }
    return String(data: data, encoding: .utf8)
  }

  func save(_ credential: String, for provider: OnboardingDraft.InferenceProvider) throws {
    let value = credential.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else {
      try clear(provider)
      return
    }
    SecItemDelete(baseQuery(provider) as CFDictionary)
    var attributes = baseQuery(provider)
    attributes[kSecValueData as String] = Data(value.utf8)
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainError(status) }
  }

  func clear(_ provider: OnboardingDraft.InferenceProvider) throws {
    let status = SecItemDelete(baseQuery(provider) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError(status)
    }
  }

  private func baseQuery(_ provider: OnboardingDraft.InferenceProvider) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: provider.rawValue,
    ]
  }
}
