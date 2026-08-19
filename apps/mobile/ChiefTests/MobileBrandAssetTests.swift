import UIKit
import XCTest
@testable import Chief

final class MobileBrandAssetTests: XCTestCase {
    func testCanonicalChiefMarkIsBundledAtFullResolution() throws {
        let image = try XCTUnwrap(UIImage(named: "ChiefMark"))
        XCTAssertEqual(image.size, CGSize(width: 1024, height: 1024))
    }
}
