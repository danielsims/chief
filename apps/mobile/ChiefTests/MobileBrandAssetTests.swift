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

    func testSVGWrappedPNGDecodesTheEmbeddedRaster() throws {
        let png = try XCTUnwrap(
            Data(
                base64Encoded:
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
            )
        )
        let svg = """
            <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
              <image width="1024" height="1024" href="data:image/png;base64,\(png.base64EncodedString())"/>
            </svg>
            """
        let image = try XCTUnwrap(BrandLogoSVG.embeddedRasterImage(in: Data(svg.utf8)))
        XCTAssertEqual(image.size, CGSize(width: 1, height: 1))
    }
}
