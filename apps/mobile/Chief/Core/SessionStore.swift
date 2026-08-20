import Foundation
import Security

protocol SessionStore: Sendable {
    func load() throws -> ChiefSession?
    func save(_ session: ChiefSession) throws
    func clear() throws
}

struct KeychainSessionStore: SessionStore {
    private let service = "sh.heychief.mobile.session"
    private let account = "active"

    func load() throws -> ChiefSession? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query(returningData: true) as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError(status)
        }
        return try JSONDecoder().decode(ChiefSession.self, from: data)
    }

    func save(_ session: ChiefSession) throws {
        let data = try JSONEncoder().encode(session)
        SecItemDelete(query(returningData: false) as CFDictionary)
        var values = query(returningData: false)
        values[kSecValueData as String] = data
        values[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
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
            kSecAttrAccount as String: account
        ]
        if returningData {
            value[kSecReturnData as String] = true
            value[kSecMatchLimit as String] = kSecMatchLimitOne
        }
        return value
    }
}

struct KeychainError: Error, Equatable {
    let status: OSStatus
    init(_ status: OSStatus) { self.status = status }
}
