import XCTest

@testable import Chief

final class WorkspaceInviteLinkTests: XCTestCase {
  private let secret = String(repeating: "a", count: 43)

  func testParsesCanonicalRelayInvite() throws {
    let link = try XCTUnwrap(
      WorkspaceInviteLink(
        url: URL(string: "https://relay.example/invite/workspace-123/\(secret)")!
      )
    )

    XCTAssertEqual(link.relayURL.absoluteString, "https://relay.example")
    XCTAssertEqual(link.workspaceID, "workspace-123")
    XCTAssertEqual(link.secret, secret)
  }

  func testParsesMobileHandoffInvite() throws {
    var components = URLComponents()
    components.scheme = "chief-mobile"
    components.host = "join"
    components.queryItems = [
      URLQueryItem(name: "relay", value: "https://relay.example"),
      URLQueryItem(name: "workspace", value: "workspace-123"),
      URLQueryItem(name: "code", value: secret),
    ]

    let link = try XCTUnwrap(WorkspaceInviteLink(url: try XCTUnwrap(components.url)))
    XCTAssertEqual(link.relayURL.absoluteString, "https://relay.example")
    XCTAssertEqual(link.workspaceID, "workspace-123")
  }

  func testRejectsInsecureRemoteRelayAndEmbeddedCredentials() {
    XCTAssertNil(
      WorkspaceInviteLink(
        url: URL(string: "http://relay.example/invite/workspace-123/\(secret)")!
      )
    )
    XCTAssertNil(
      WorkspaceInviteLink(
        url: URL(string: "https://user@relay.example/invite/workspace-123/\(secret)")!
      )
    )
  }

  func testAllowsHTTPForLocalDevelopmentOnly() {
    XCTAssertNotNil(
      WorkspaceInviteLink(
        url: URL(string: "http://localhost:8787/invite/workspace-123/\(secret)")!
      )
    )
  }
}
