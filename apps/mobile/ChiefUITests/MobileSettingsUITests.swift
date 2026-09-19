import XCTest

@MainActor
final class MobileSettingsUITests: XCTestCase {
  func testAvatarActionsAndSettingsPages() {
    let app = launch()
    app.buttons["Open profile"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Delete account"].waitForExistence(timeout: 3))
    XCTAssertFalse(app.staticTexts["Profile photo"].exists)
    attach("Settings overview", app)
    app.buttons["Edit photo"].tap()
    XCTAssertTrue(app.buttons["Choose photo"].waitForExistence(timeout: 3))
    if app.buttons["Cancel"].exists {
      app.buttons["Cancel"].tap()
    } else {
      app.otherElements["PopoverDismissRegion"].tap()
    }
    app.buttons.matching(NSPredicate(format: "label == %@", "Connection")).firstMatch.tap()
    XCTAssertTrue(app.navigationBars["Connection"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["Agent provider"].waitForExistence(timeout: 5))
    attach("Connection settings", app)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Workspace settings")).firstMatch
      .tap()
    XCTAssertTrue(app.textFields["Name"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.textFields["Website"].exists)
    XCTAssertTrue(app.buttons["Edit photo"].exists)
    attach("Workspace settings", app)
  }

  func testSubagentsCollapseAndPushIndependentDetails() {
    let app = launch()
    app.buttons["Agents"].tap()
    let content = app.buttons["agent-row-content"]
    XCTAssertTrue(content.waitForExistence(timeout: 5))
    attach("Agent hierarchy", app)
    app.buttons["Collapse Chief subagents"].tap()
    XCTAssertFalse(content.exists)
    app.buttons["Expand Chief subagents"].tap()
    XCTAssertTrue(content.waitForExistence(timeout: 3))
    app.buttons["agent-row-chief"].tap()
    XCTAssertTrue(app.navigationBars["Chief"].waitForExistence(timeout: 3))
    let specialist = app.buttons["subagent-detail-content"]
    if !specialist.isHittable { app.swipeUp() }
    specialist.tap()
    XCTAssertTrue(app.navigationBars["Content"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["Configuration"].exists)
    XCTAssertFalse(app.staticTexts["Specialist"].exists)
    attach("Specialist detail", app)
    app.swipeRight()
    XCTAssertTrue(app.navigationBars["Chief"].waitForExistence(timeout: 3))
  }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "--reset-session"]
    app.launch()
    XCTAssertTrue(app.buttons["Open profile"].waitForExistence(timeout: 5))
    return app
  }

  private func attach(_ name: String, _ app: XCUIApplication) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
