import Foundation
import XCTest

@testable import Chief

final class OAuthAuthenticationTests: XCTestCase {
  func testAuthorizationUsesPKCEAndReturnsOnlyACodeThroughTheApp() async throws {
    let configuration = AppConfiguration(
      relayURL: URL(string: "https://relay.test")!,
      accountURL: URL(string: "https://account.test")!,
      demoMode: false
    )
    let client = URLSessionOAuthAuthenticationClient(configuration: configuration)
    let request = try await client.makeAuthorizationRequest()
    let signInComponents = try XCTUnwrap(
      URLComponents(url: request.authorizationURL, resolvingAgainstBaseURL: false)
    )
    let callback = try XCTUnwrap(signInComponents.queryValue("callbackUrl"))
    let components = try XCTUnwrap(
      URLComponents(string: "https://account.test\(callback)")
    )

    XCTAssertEqual(signInComponents.path, "/sign-in")
    XCTAssertEqual(signInComponents.queryValue("switchAccount"), "1")
    XCTAssertEqual(components.path, "/api/auth/oauth2/authorize")
    XCTAssertEqual(components.queryValue("client_id"), "chief-mobile")
    XCTAssertEqual(components.queryValue("redirect_uri"), "chief-mobile://auth")
    XCTAssertEqual(components.queryValue("response_type"), "code")
    XCTAssertEqual(components.queryValue("code_challenge_method"), "S256")
    XCTAssertEqual(components.queryValue("resource"), "https://relay.test")
    XCTAssertEqual(components.queryValue("code_challenge")?.count, 43)
    XCTAssertNotNil(components.queryValue("state"))
    XCTAssertNil(components.queryValue("access_token"))
    XCTAssertNil(components.queryValue("refresh_token"))
  }

  func testAuthorizationAlwaysStartsWithGoogleAccountSelection() async throws {
    let configuration = AppConfiguration(
      relayURL: URL(string: "https://relay.test")!,
      accountURL: URL(string: "https://account.test")!,
      demoMode: false
    )
    let client = URLSessionOAuthAuthenticationClient(configuration: configuration)
    let request = try await client.makeAuthorizationRequest()
    let components = try XCTUnwrap(
      URLComponents(url: request.authorizationURL, resolvingAgainstBaseURL: false)
    )

    XCTAssertEqual(components.path, "/sign-in")
    XCTAssertEqual(components.queryValue("switchAccount"), "1")
    let callback = try XCTUnwrap(components.queryValue("callbackUrl"))
    XCTAssertTrue(callback.hasPrefix("/api/auth/oauth2/authorize?"))
    XCTAssertTrue(callback.contains("client_id=chief-mobile"))
    XCTAssertFalse(callback.contains("code_verifier"))
  }
}

extension URLComponents {
  fileprivate func queryValue(_ name: String) -> String? {
    queryItems?.first(where: { $0.name == name })?.value
  }
}
