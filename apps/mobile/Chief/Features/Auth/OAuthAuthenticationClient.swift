import CryptoKit
import Foundation
import OSLog
import Security

private let oauthAuthenticationLog = Logger(
  subsystem: "sh.heychief.mobile",
  category: "authentication"
)

struct MobileAuthorizationRequest: Equatable, Sendable {
  let authorizationURL: URL
  let callbackURL: URL
  fileprivate let state: String
  fileprivate let codeVerifier: String
}

protocol MobileAuthenticationServing: Sendable {
  func makeAuthorizationRequest() async throws -> MobileAuthorizationRequest
  func exchange(
    callbackURL: URL,
    request: MobileAuthorizationRequest
  ) async throws -> ChiefSession
  func refreshAccountSession(_ session: ChiefSession) async throws -> ChiefSession
  func inviteOrganizationMember(
    email: String,
    organizationID: String,
    session: ChiefSession
  ) async throws
}

/// OAuth 2.1 Authorization Code + PKCE client for the native Chief app.
///
/// The system browser owns the user's web session. Only a short-lived code is
/// returned through the custom URL scheme; access and refresh tokens are
/// exchanged directly with the relay and remain in the device Keychain.
actor URLSessionOAuthAuthenticationClient: MobileAuthenticationServing {
  private static let clientID = "chief-mobile"
  private static let scope = "openid profile email offline_access"

  private let configuration: AppConfiguration
  private let session: URLSession
  private let decoder = JSONDecoder()

  init(configuration: AppConfiguration, session: URLSession = .shared) {
    self.configuration = configuration
    self.session = session
  }

  func makeAuthorizationRequest() async throws -> MobileAuthorizationRequest {
    let state = try Self.randomBase64URL(byteCount: 24)
    let codeVerifier = try Self.randomBase64URL(byteCount: 32)
    let digest = SHA256.hash(data: Data(codeVerifier.utf8))
    let codeChallenge = Data(digest).base64URLEncodedString()
    let callbackURL = configuration.authenticationCallbackURL

    var components = URLComponents(
      url: configuration.accountURL.appending(path: "api/auth/oauth2/authorize"),
      resolvingAgainstBaseURL: false
    )
    components?.queryItems = [
      URLQueryItem(name: "client_id", value: Self.clientID),
      URLQueryItem(name: "redirect_uri", value: callbackURL.absoluteString),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "scope", value: Self.scope),
      URLQueryItem(name: "code_challenge", value: codeChallenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "resource", value: configuration.relayURL.absoluteString),
    ]
    guard let relayAuthorizationURL = components?.url else {
      throw MobileAuthenticationError.invalidResponse
    }
    var signIn = URLComponents(
      url: configuration.accountURL.appending(path: "sign-in"),
      resolvingAgainstBaseURL: false
    )
    signIn?.queryItems = [
      URLQueryItem(name: "switchAccount", value: "1"),
      URLQueryItem(
        name: "callbackUrl",
        value: relayAuthorizationURL.path(percentEncoded: true)
          + (relayAuthorizationURL.query.map { "?\($0)" } ?? "")
      ),
    ]
    guard let authorizationURL = signIn?.url else {
      throw MobileAuthenticationError.invalidResponse
    }
    return MobileAuthorizationRequest(
      authorizationURL: authorizationURL,
      callbackURL: callbackURL,
      state: state,
      codeVerifier: codeVerifier
    )
  }

  func exchange(
    callbackURL: URL,
    request authorization: MobileAuthorizationRequest
  ) async throws -> ChiefSession {
    guard callbackURL.scheme?.lowercased() == authorization.callbackURL.scheme?.lowercased(),
      callbackURL.host?.lowercased() == authorization.callbackURL.host?.lowercased()
    else { throw MobileAuthenticationError.invalidResponse }

    let query = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
    if let error = query.value(named: "error") {
      oauthAuthenticationLog.notice(
        "Authorization was rejected by the relay: \(error, privacy: .public)"
      )
      throw MobileAuthenticationError.denied
    }
    guard query.value(named: "state") == authorization.state else {
      throw MobileAuthenticationError.stateMismatch
    }
    guard let code = query.value(named: "code"), !code.isEmpty else {
      throw MobileAuthenticationError.invalidResponse
    }

    let token = try await requestToken(form: [
      "grant_type": "authorization_code",
      "client_id": Self.clientID,
      "code": code,
      "code_verifier": authorization.codeVerifier,
      "redirect_uri": authorization.callbackURL.absoluteString,
    ])
    return try await session(from: token, workspaceID: nil)
  }

  func refreshAccountSession(_ current: ChiefSession) async throws -> ChiefSession {
    if current.accessTokenExpiresAt.map({ $0 > Date().addingTimeInterval(60) }) != false,
      let user = try? await loadCurrentUser(accessToken: current.accessToken)
    {
      return ChiefSession(
        accessToken: current.accessToken,
        sessionToken: current.accessToken,
        refreshToken: current.refreshToken,
        accessTokenExpiresAt: current.accessTokenExpiresAt,
        user: user,
        workspaceID: current.workspaceID
      )
    }

    guard let refreshToken = current.refreshToken else {
      throw MobileAuthenticationError.invalidSession
    }
    let token = try await requestToken(form: [
      "grant_type": "refresh_token",
      "client_id": Self.clientID,
      "refresh_token": refreshToken,
    ])
    let refreshed = try await session(from: token, workspaceID: current.workspaceID)
    return ChiefSession(
      accessToken: refreshed.accessToken,
      sessionToken: refreshed.sessionToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      user: refreshed.user,
      workspaceID: refreshed.workspaceID
    )
  }

  func inviteOrganizationMember(
    email: String,
    organizationID: String,
    session current: ChiefSession
  ) async throws {
    var request = URLRequest(url: endpoint(path: "organization/invite-member"))
    request.httpMethod = "POST"
    request.setValue("Bearer \(current.accessToken)", forHTTPHeaderField: "authorization")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONEncoder().encode(
      OrganizationMemberInvitationRequest(
        email: email,
        role: "member",
        organizationId: organizationID,
        resend: true
      )
    )

    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw OrganizationInvitationError.network
    }
    guard (200..<300).contains(http.statusCode) else {
      let envelope = try? decoder.decode(BetterAuthErrorEnvelope.self, from: data)
      oauthAuthenticationLog.error(
        "Organization invitation returned HTTP \(http.statusCode): \(envelope?.message ?? "unknown", privacy: .public)"
      )
      throw OrganizationInvitationError.rejected
    }
  }

  private func session(from token: OAuthToken, workspaceID: String?) async throws -> ChiefSession {
    guard token.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame else {
      throw MobileAuthenticationError.invalidResponse
    }
    let user = try await loadCurrentUser(accessToken: token.accessToken)
    return ChiefSession(
      accessToken: token.accessToken,
      sessionToken: token.accessToken,
      refreshToken: token.refreshToken,
      accessTokenExpiresAt: token.expiresIn.map {
        Date().addingTimeInterval(TimeInterval($0))
      },
      user: user,
      workspaceID: workspaceID
    )
  }

  private func requestToken(form: [String: String]) async throws -> OAuthToken {
    var request = URLRequest(url: endpoint(path: "oauth2/token"))
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    request.httpBody =
      form
      .sorted(by: { $0.key < $1.key })
      .map { key, value in
        "\(key.formURLEncoded)=\(value.formURLEncoded)"
      }
      .joined(separator: "&")
      .data(using: .utf8)

    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw MobileAuthenticationError.network
    }
    guard (200..<300).contains(http.statusCode) else {
      oauthAuthenticationLog.error("Token exchange returned HTTP \(http.statusCode)")
      throw MobileAuthenticationError.invalidSession
    }
    guard let token = try? decoder.decode(OAuthToken.self, from: data) else {
      oauthAuthenticationLog.error("Token exchange returned an invalid response")
      throw MobileAuthenticationError.invalidResponse
    }
    return token
  }

  private func loadCurrentUser(accessToken: String) async throws -> ChiefUser {
    var request = URLRequest(url: endpoint(path: "oauth2/userinfo"))
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "authorization")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
    else { throw MobileAuthenticationError.invalidSession }
    guard let envelope = try? decoder.decode(OAuthUserInfo.self, from: data) else {
      throw MobileAuthenticationError.invalidResponse
    }
    return ChiefUser(
      id: envelope.subject,
      name: envelope.name?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        ?? envelope.email,
      imageURL: envelope.picture
    )
  }

  private func endpoint(path: String) -> URL {
    configuration.authenticationAPIURL.appending(path: path)
  }

  private static func randomBase64URL(byteCount: Int) throws -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw MobileAuthenticationError.randomnessUnavailable
    }
    return Data(bytes).base64URLEncodedString()
  }
}

enum OrganizationInvitationError: Error, LocalizedError {
  case network
  case rejected

  var errorDescription: String? {
    switch self {
    case .network: "Chief couldn’t reach this workspace’s account service."
    case .rejected: "Chief couldn’t send this invitation. Check the address and try again."
    }
  }
}

private struct OrganizationMemberInvitationRequest: Encodable {
  let email: String
  let role: String
  let organizationId: String
  let resend: Bool
}

private struct BetterAuthErrorEnvelope: Decodable {
  let message: String?
}

enum MobileAuthenticationError: Error, Equatable, LocalizedError {
  case denied
  case stateMismatch
  case invalidSession
  case invalidResponse
  case network
  case randomnessUnavailable

  var errorDescription: String? {
    switch self {
    case .denied: "Sign in was cancelled."
    case .stateMismatch: "Chief could not verify the sign-in response."
    case .invalidSession: "Chief could not load your account after signing in."
    case .invalidResponse: "The sign-in service returned an invalid response."
    case .network: "Chief could not reach the sign-in service."
    case .randomnessUnavailable: "Chief could not securely start sign in."
    }
  }
}

private struct OAuthToken: Decodable {
  let accessToken: String
  let refreshToken: String?
  let expiresIn: Int?
  let tokenType: String

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case refreshToken = "refresh_token"
    case expiresIn = "expires_in"
    case tokenType = "token_type"
  }
}

private struct OAuthUserInfo: Decodable {
  let subject: String
  let name: String?
  let email: String
  let picture: URL?

  enum CodingKeys: String, CodingKey {
    case subject = "sub"
    case name
    case email
    case picture
  }
}

extension Data {
  fileprivate func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

extension String {
  fileprivate var formURLEncoded: String {
    addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? self
  }

  fileprivate var nonEmpty: String? { isEmpty ? nil : self }
}

extension Array where Element == URLQueryItem {
  fileprivate func value(named name: String) -> String? {
    first(where: { $0.name == name })?.value
  }
}

extension CharacterSet {
  fileprivate static let urlQueryValueAllowed: CharacterSet = {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return allowed
  }()
}
