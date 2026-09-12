import UIKit
import XCTest
@testable import Chief

final class MobileBrandAssetTests: XCTestCase {
    func testCanonicalChiefMarkIsBundledAtFullResolution() throws {
        let image = try XCTUnwrap(UIImage(named: "ChiefMark"))
        XCTAssertEqual(image.size, CGSize(width: 1024, height: 1024))
    }
    @MainActor
    func testPriorityPluginLogosAreAvailableWithoutNetwork() throws {
        for domain in PluginCatalogClient.priorityDomains {
            let image = try XCTUnwrap(BrandLogoImage.bundled(domain: domain), domain)
            XCTAssertGreaterThan(image.size.width, 0, domain)
        }
        XCTAssertNotNil(BrandLogoImage.bundled(domain: "granola.ai"))
    }
}
