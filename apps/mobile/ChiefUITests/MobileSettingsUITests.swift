import XCTest

@MainActor
final class MobileSettingsUITests: XCTestCase {
  func testAvatarActionsAndSettingsPages() {
    let app = launch()
    app.buttons["Open profile"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    attach("Settings overview", app)

    open("Profile", in: app)
    XCTAssertTrue(app.buttons["Delete account"].waitForExistence(timeout: 3))
    attach("Profile", app)
    app.buttons["Edit photo"].tap()
    XCTAssertTrue(app.buttons["Choose photo"].waitForExistence(timeout: 3))
    if app.buttons["Cancel"].exists {
      app.buttons["Cancel"].tap()
    } else {
      app.otherElements["PopoverDismissRegion"].tap()
    }
    back(app)

    for page in [
      "Notifications", "Workspace", "Connection", "Missions", "Webhooks", "Environment",
      "Machines",
    ] {
      open(page, in: app)
      XCTAssertTrue(app.navigationBars[page].waitForExistence(timeout: 5))
      sleep(2)
      attach(page, app)
      if page == "Workspace" {
        app.buttons["Invite people"].tap()
        XCTAssertTrue(app.buttons["Send invite"].waitForExistence(timeout: 3))
        attach("Invite people", app)
        app.buttons["Done"].tap()
      }
      back(app)
    }
  }

  private func open(_ page: String, in app: XCUIApplication) {
    let row = app.scrollViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", page)).firstMatch
    if !row.isHittable { app.swipeUp() }
    row.tap()
  }

  private func back(_ app: XCUIApplication) {
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 3))
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
