import Foundation

struct DeviceAuthorizationChallenge: Decodable, Equatable, Sendable {
  let deviceCode: String
  let userCode: String
  let verificationURL: URL
  let verificationCompleteURL: URL
  let expiresIn: Int
  let interval: Int

  enum CodingKeys: String, CodingKey {
    case deviceCode = "device_code"
    case userCode = "user_code"
    case verificationURL = "verification_uri"
    case verificationCompleteURL = "verification_uri_complete"
    case expiresIn = "expires_in"
    case interval
  }

  func browserURL(returningTo callback: URL) -> URL {
    var components = URLComponents(
      url: verificationCompleteURL,
      resolvingAgainstBaseURL: false)
    var items = components?.queryItems ?? []
    items.append(URLQueryItem(name: "return_to", value: callback.absoluteString))
    components?.queryItems = items
    return components?.url ?? verificationCompleteURL
  }
}

protocol DeviceAuthorizationServing: Sendable {
  func requestAuthorization() async throws -> DeviceAuthorizationChallenge
  func exchange(_ challenge: DeviceAuthorizationChallenge) async throws -> ChiefSession
}

actor URLSessionDeviceAuthorizationClient: DeviceAuthorizationServing {
  private let configuration: AppConfiguration
  private let session: URLSession
  private let decoder = JSONDecoder()

  init(configuration: AppConfiguration, session: URLSession = .shared) {
    self.configuration = configuration
    self.session = session
  }

  func requestAuthorization() async throws -> DeviceAuthorizationChallenge {
    let body = try JSONEncoder().encode(
      DeviceCodeRequest(clientID: "chief-mobile", scope: "openid profile email"))
    do {
      return try await request(path: "device/code", body: body)
    } catch {
      // The auth deployment can briefly wake cold on mobile. One bounded retry
      // keeps that transient from surfacing as a dead-end sign-in error.
      try await Task.sleep(for: .milliseconds(500))
      return try await request(path: "device/code", body: body)
    }
  }

  func exchange(_ challenge: DeviceAuthorizationChallenge) async throws -> ChiefSession {
    let deadline = Date().addingTimeInterval(TimeInterval(challenge.expiresIn))
    var interval = max(challenge.interval, 1)
    var transientFailures = 0

    while Date() < deadline {
      let tokenResult = await requestToken(deviceCode: challenge.deviceCode)
      switch tokenResult {
      case .success(let token):
        let user = try await loadCurrentUser(accessToken: token.accessToken)
        let relayToken = try await loadRelayToken(sessionToken: token.accessToken)
        return ChiefSession(
          accessToken: relayToken,
          sessionToken: token.accessToken,
          user: user,
          workspaceID: nil
        )
      case .pending:
        transientFailures = 0
        try await Task.sleep(for: .seconds(interval))
      case .slowDown:
        transientFailures = 0
        interval += 5
        try await Task.sleep(for: .seconds(interval))
      case .transient(let error):
        transientFailures += 1
        guard transientFailures < 3 else { throw error }
        try await Task.sleep(for: .seconds(interval))
      case .failure(let error):
        throw error
      }
    }

    throw DeviceAuthorizationError.expired
  }

  private func requestToken(deviceCode: String) async -> DeviceTokenResult {
    do {
      let body = try JSONEncoder().encode(
        DeviceTokenRequest(
          grantType: "urn:ietf:params:oauth:grant-type:device_code",
          deviceCode: deviceCode,
          clientID: "chief-mobile"))
      let response = try await response(path: "device/token", body: body)
      if (200..<300).contains(response.statusCode) {
        return .success(try decoder.decode(DeviceToken.self, from: response.data))
      }
      let failure = try decoder.decode(DeviceFailure.self, from: response.data)
      switch failure.error {
      case "authorization_pending": return .pending
      case "slow_down": return .slowDown
      case "access_denied": return .failure(.denied)
      case "expired_token": return .failure(.expired)
      case "server_error": return .transient(.server(failure.description))
      default: return .failure(.server(failure.description))
      }
    } catch let error as DeviceAuthorizationError {
      return .failure(error)
    } catch {
      return .transient(.network)
    }
  }

  private func loadCurrentUser(accessToken: String) async throws -> ChiefUser {
    var request = URLRequest(url: endpoint(path: "get-session"))
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "authorization")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
    else { throw DeviceAuthorizationError.invalidSession }
    let envelope = try decoder.decode(AuthSessionEnvelope.self, from: data)
    return ChiefUser(
      id: envelope.user.id,
      name: envelope.user.name ?? envelope.user.email,
      imageURL: envelope.user.image)
  }

  private func loadRelayToken(sessionToken: String) async throws -> String {
    var request = URLRequest(url: endpoint(path: "convex/token"))
    request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "authorization")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
    else { throw DeviceAuthorizationError.invalidSession }
    return try decoder.decode(RelayTokenEnvelope.self, from: data).token
  }

  private func request<Response: Decodable>(path: String, body: Data) async throws -> Response {
    let result = try await response(path: path, body: body)
    guard (200..<300).contains(result.statusCode)
    else { throw DeviceAuthorizationError.server("Request failed") }
    return try decoder.decode(Response.self, from: result.data)
  }

  private func response(path: String, body: Data) async throws -> HTTPResult {
    var request = URLRequest(url: endpoint(path: path))
    request.httpMethod = "POST"
    request.httpBody = body
    // Better Auth protects state-changing endpoints with an Origin check.
    // URLSession does not add one for native requests, so identify this
    // first-party client with the configured account origin explicitly.
    request.setValue(accountOrigin, forHTTPHeaderField: "origin")
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw DeviceAuthorizationError.network
    }
    return HTTPResult(data: data, statusCode: http.statusCode)
  }

  private func endpoint(path: String) -> URL {
    configuration.authenticationAPIURL.appending(path: path)
  }

  private var accountOrigin: String {
    var components = URLComponents()
    components.scheme = configuration.accountURL.scheme
    components.host = configuration.accountURL.host
    components.port = configuration.accountURL.port
    return components.string ?? configuration.accountURL.absoluteString
  }
}

enum DeviceAuthorizationError: Error, Equatable, LocalizedError {
  case denied
  case expired
  case invalidSession
  case network
  case server(String)

  var errorDescription: String? {
    switch self {
    case .denied: "Sign in was cancelled."
    case .expired: "This sign-in request expired. Please try again."
    case .invalidSession: "Chief could not load your account after signing in."
    case .network: "Chief could not reach the sign-in service."
    case .server(let message): message
    }
  }
}

private struct HTTPResult {
  let data: Data
  let statusCode: Int
}
private struct DeviceCodeRequest: Encodable {
  let clientID: String
  let scope: String
  enum CodingKeys: String, CodingKey {
    case clientID = "client_id"
    case scope
  }
}
private struct DeviceTokenRequest: Encodable {
  let grantType: String
  let deviceCode: String
  let clientID: String
  enum CodingKeys: String, CodingKey {
    case grantType = "grant_type"
    case deviceCode = "device_code"
    case clientID = "client_id"
  }
}
private struct DeviceToken: Decodable {
  let accessToken: String
  enum CodingKeys: String, CodingKey { case accessToken = "access_token" }
}
private struct DeviceFailure: Decodable {
  let error: String
  let description: String
  enum CodingKeys: String, CodingKey {
    case error
    case description = "error_description"
  }
}
private struct AuthSessionEnvelope: Decodable {
  struct User: Decodable {
    let id: String
    let name: String?
    let email: String
    let image: URL?
  }
  let user: User
}
private struct RelayTokenEnvelope: Decodable { let token: String }
private enum DeviceTokenResult {
  case success(DeviceToken)
  case pending
  case slowDown
  case transient(DeviceAuthorizationError)
  case failure(DeviceAuthorizationError)
}
