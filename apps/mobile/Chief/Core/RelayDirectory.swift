import Foundation

struct RelayConnectionRecord: Codable, Equatable, Identifiable, Sendable {
  let relayURL: URL
  let accountURL: URL

  var id: String { relayURL.absoluteString }
}

struct RelayWorkspaceLocation: Codable, Equatable, Sendable {
  let relayURL: URL
  let summary: WorkspaceSummary
}

private struct StoredRelayDirectory: Codable {
  var activeRelayURL: URL?
  var connections: [RelayConnectionRecord]
  var workspaces: [String: RelayWorkspaceLocation]

  static let empty = StoredRelayDirectory(
    activeRelayURL: nil,
    connections: [],
    workspaces: [:]
  )
}

struct RelayDirectoryStore {
  private let defaults: UserDefaults
  private let key = "chief.relay-directory.v1"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  func activeConnection() -> RelayConnectionRecord? {
    let directory = load()
    guard let active = directory.activeRelayURL else { return nil }
    return directory.connections.first { Self.sameOrigin($0.relayURL, active) }
  }

  func connections() -> [RelayConnectionRecord] { load().connections }

  func connection(for relayURL: URL) -> RelayConnectionRecord? {
    load().connections.first { Self.sameOrigin($0.relayURL, relayURL) }
  }

  func activate(_ connection: RelayConnectionRecord) {
    var directory = load()
    directory.connections.removeAll { Self.sameOrigin($0.relayURL, connection.relayURL) }
    directory.connections.append(connection)
    directory.activeRelayURL = connection.relayURL
    save(directory)
  }

  func activateChiefCloud() {
    var directory = load()
    directory.activeRelayURL = nil
    save(directory)
  }

  func remember(workspaces: [WorkspaceSummary], at relayURL: URL) {
    var directory = load()
    directory.workspaces = directory.workspaces.filter {
      !Self.sameOrigin($0.value.relayURL, relayURL)
    }
    for summary in workspaces {
      directory.workspaces[summary.id] = RelayWorkspaceLocation(
        relayURL: relayURL,
        summary: summary
      )
    }
    save(directory)
  }

  func location(for workspaceID: String) -> RelayWorkspaceLocation? {
    load().workspaces[workspaceID]
  }

  func workspaceSummaries(activeWorkspaceID: String?) -> [WorkspaceSummary] {
    load().workspaces.values.map { location in
      WorkspaceSummary(
        id: location.summary.id,
        name: location.summary.name,
        website: location.summary.website,
        imageURL: location.summary.imageURL,
        isActive: location.summary.id == activeWorkspaceID,
        onboardingComplete: location.summary.onboardingComplete
      )
    }
  }

  private func load() -> StoredRelayDirectory {
    guard let data = defaults.data(forKey: key),
      let directory = try? JSONDecoder().decode(StoredRelayDirectory.self, from: data)
    else { return .empty }
    return directory
  }

  private func save(_ directory: StoredRelayDirectory) {
    guard let data = try? JSONEncoder().encode(directory) else { return }
    defaults.set(data, forKey: key)
  }

  static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
    lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
      && lhs.host?.lowercased() == rhs.host?.lowercased()
      && lhs.port == rhs.port
  }
}

enum RelayConnectionValidator {
  static func validate(_ value: String, session: URLSession = .shared) async throws
    -> RelayConnectionRecord
  {
    let relayURL = try normalizedOrigin(value)
    let discoveryURL = relayURL.appending(path: ".well-known/chief-relay")
    var request = URLRequest(url: discoveryURL)
    request.setValue("application/json", forHTTPHeaderField: "accept")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw RelayConnectionValidationError.unavailable
    }
    let discovery = try JSONDecoder().decode(RelayDiscoveryDocument.self, from: data)
    guard discovery.protocolName == "chief-relay", discovery.protocolVersion == 1,
      discovery.authentication.scheme == "NIP-98",
      discovery.authentication.signingAlgorithm == "secp256k1-schnorr"
    else { throw RelayConnectionValidationError.unsupported }
    let issuer = discovery.authentication.accountIssuer
    guard issuer.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == "api/auth"
    else { throw RelayConnectionValidationError.unsupported }
    let accountURL = try normalizedOrigin(issuer.absoluteString)
    return RelayConnectionRecord(relayURL: relayURL, accountURL: accountURL)
  }

  private static func normalizedOrigin(_ value: String) throws -> URL {
    let address = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let lowercasedAddress = address.lowercased()
    let addressWithScheme: String
    if address.range(
      of: #"^[A-Za-z][A-Za-z0-9+.-]*://"#,
      options: .regularExpression
    ) != nil {
      addressWithScheme = address
    } else if lowercasedAddress == "localhost"
      || lowercasedAddress.hasPrefix("localhost:")
      || lowercasedAddress == "127.0.0.1"
      || lowercasedAddress.hasPrefix("127.0.0.1:")
    {
      addressWithScheme = "http://\(address)"
    } else {
      addressWithScheme = "https://\(address)"
    }
    guard
      let components = URLComponents(string: addressWithScheme),
      components.user == nil, components.password == nil, components.query == nil,
      components.fragment == nil, components.host != nil,
      components.path.isEmpty || components.path == "/"
    else { throw RelayConnectionValidationError.invalidAddress }
    let local = components.host == "localhost" || components.host == "127.0.0.1"
    guard components.scheme == "https" || (local && components.scheme == "http") else {
      throw RelayConnectionValidationError.insecure
    }
    var origin = components
    origin.path = ""
    guard let url = origin.url else { throw RelayConnectionValidationError.invalidAddress }
    return url
  }
}

private struct RelayDiscoveryDocument: Decodable {
  let protocolName: String
  let protocolVersion: Int
  let authentication: Authentication

  struct Authentication: Decodable {
    let scheme: String
    let signingAlgorithm: String
    let accountIssuer: URL
  }

  enum CodingKeys: String, CodingKey {
    case protocolName = "protocol"
    case protocolVersion, authentication
  }
}

enum RelayConnectionValidationError: LocalizedError {
  case invalidAddress, insecure, unavailable, unsupported

  var errorDescription: String? {
    switch self {
    case .invalidAddress: "Enter the relay address without a path or credentials."
    case .insecure: "Self-hosted relays must use HTTPS."
    case .unavailable: "Chief couldn’t reach this relay."
    case .unsupported: "This server is not a compatible Chief relay."
    }
  }
}
