import Foundation
import XCTest

@testable import Chief

final class DeviceAuthorizationTests: XCTestCase {
  func testChallengeReturnsThroughTheAppWithoutPuttingATokenInTheURL() throws {
    let data = Data(
      """
      {
        "device_code": "device-secret",
        "user_code": "ABCD1234",
        "verification_uri": "https://heychief.sh/device",
        "verification_uri_complete": "https://heychief.sh/device?user_code=ABCD1234",
        "expires_in": 1800,
        "interval": 5
      }
      """.utf8)
    let challenge = try JSONDecoder().decode(DeviceAuthorizationChallenge.self, from: data)
    let browserURL = challenge.browserURL(returningTo: URL(string: "chief-mobile://auth")!)
    let components = try XCTUnwrap(URLComponents(url: browserURL, resolvingAgainstBaseURL: false))

    XCTAssertEqual(components.path, "/device")
    XCTAssertEqual(
      components.queryItems?.first(where: { $0.name == "return_to" })?.value,
      "chief-mobile://auth")
    XCTAssertNil(components.queryItems?.first(where: { $0.name == "session_token" }))
    XCTAssertFalse(browserURL.absoluteString.contains(challenge.deviceCode))
  }
}
