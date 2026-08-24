import XCTest

@testable import Chief

final class WorkspaceIdentityTests: XCTestCase {
  func testFaviconCandidatesMatchDesktopSourceOrder() throws {
    let explicit = try XCTUnwrap(URL(string: "https://assets.example/logo.png"))
    let candidates = WorkspaceFaviconSource.candidates(
      website: "heychief.sh/about?ref=mobile",
      imageURL: explicit
    )

    XCTAssertEqual(candidates.first?.url, explicit)
    XCTAssertEqual(candidates[1].url.absoluteString, "https://heychief.sh/favicon.ico")
    XCTAssertEqual(candidates[2].url.absoluteString, "https://heychief.sh/favicon.svg")
    XCTAssertEqual(candidates[3].url.absoluteString, "https://heychief.sh/apple-touch-icon.png")
    XCTAssertEqual(candidates[4].url.host, "www.google.com")
    XCTAssertEqual(candidates[4].minimumPixelWidth, 32)
  }

  func testInvalidWebsiteStillUsesExplicitWorkspaceImage() throws {
    let explicit = try XCTUnwrap(URL(string: "https://assets.example/logo.png"))
    let candidates = WorkspaceFaviconSource.candidates(
      website: "not a valid website",
      imageURL: explicit
    )

    XCTAssertEqual(candidates.map(\.url), [explicit])
  }
}
