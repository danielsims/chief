import XCTest

@MainActor
final class ScheduledRunUITests: XCTestCase {
  func testRunCardOpensThreadAndSavedArtifact() {
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "--reset-session", "--demo-scheduled-run"]
    app.launch()
    let channel = app.staticTexts["mission-control"].firstMatch
    XCTAssertTrue(channel.waitForExistence(timeout: 10))
    channel.tap()
    let card = app.buttons["scheduled-run-card"].firstMatch
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["scheduled-run-progress"].firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Marketer working"].exists)
    attach("Mobile scheduled run", app)
    card.tap()
    XCTAssertTrue(app.navigationBars["Thread"].waitForExistence(timeout: 5))
    let artifact = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Launch draft"))
      .firstMatch
    XCTAssertTrue(artifact.waitForExistence(timeout: 5))
    artifact.tap()
    XCTAssertTrue(app.navigationBars["Launch draft"].waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.textViews.matching(NSPredicate(format: "label CONTAINS %@", "Build something useful"))
        .firstMatch.waitForExistence(timeout: 5))
    attach("Mobile saved artifact", app)
  }

  private func attach(_ name: String, _ app: XCUIApplication) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
