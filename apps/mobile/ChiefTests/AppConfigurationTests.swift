import XCTest

@testable import Chief

final class AppConfigurationTests: XCTestCase {
  func testNativeAuthenticationUsesTheDeviceAPIAndASeparateCallback() {
    let configuration = AppConfiguration(
      relayURL: URL(string: "https://relay.heychief.sh")!,
      accountURL: URL(string: "https://heychief.sh")!,
      demoMode: false
    )

    XCTAssertEqual(
      configuration.authenticationAPIURL.absoluteString,
      "https://heychief.sh/api/auth")
    XCTAssertEqual(
      configuration.authenticationCallbackURL.absoluteString,
      "chief-mobile://auth")
  }
}
