import XCTest

@MainActor
final class ChiefLaunchTests: XCTestCase {
  func testDemoWorkspaceOpensTheSameCoreSurfacesAsDesktop() {
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "--reset-session"]
    app.launch()

    XCTAssertTrue(app.buttons["Home"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Plugins"].exists)
    XCTAssertTrue(app.buttons["Projects"].exists)
    XCTAssertTrue(app.staticTexts["Channels"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["DMs"].exists)
    XCTAssertFalse(app.navigationBars["Overview"].exists)
    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Good '")).firstMatch.exists)

    app.buttons["Plugins"].tap()
    XCTAssertTrue(app.staticTexts["Plugins"].waitForExistence(timeout: 3))
    app.buttons["Projects"].tap()
    XCTAssertTrue(app.buttons["Add project"].waitForExistence(timeout: 3))
    app.buttons["Home"].tap()

    // Tapping a channel opens the conversation view with its messages.
    app.staticTexts["mission-control"].tap()
    XCTAssertTrue(
      app.textViews[
        "The team is moving. Engineering has the relay vertical slice ready for review."
      ].waitForExistence(timeout: 4))
  }

  func testSignedOutExperienceUsesTheAgentTeamPromise() {
    let app = XCUIApplication()
    app.launchArguments = ["--reset-session"]
    app.launch()

    XCTAssertTrue(
      app.staticTexts["Your team of agents,\nalready at work."].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["sign-in-button"].exists)
    XCTAssertTrue(app.buttons["google-sign-in-button"].exists)
    XCTAssertTrue(app.links["Privacy"].exists)
    XCTAssertTrue(app.links["Terms"].exists)
    XCTAssertFalse(app.textFields["relay-address"].exists)
  }

  func testWorkspaceAndProfileControlsAreFirstClass() {
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "--reset-session"]
    app.launch()

    XCTAssertTrue(app.buttons["Open profile"].waitForExistence(timeout: 5))
    app.buttons["workspace-switcher"].tap()
    XCTAssertTrue(app.navigationBars["Workspaces"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["Create workspace"].exists)
  }

  func testOnboardingStaysRecoverableWhenRelayIsUnavailable() {
    let app = XCUIApplication()
    app.launchArguments = ["--preview-onboarding"]
    app.launch()

    let company = app.textFields["Workspace name"]
    XCTAssertTrue(company.waitForExistence(timeout: 5))
    company.tap()
    company.typeText("Chief Mobile QA")
    app.buttons["Continue"].tap()
    XCTAssertTrue(app.buttons["This iPhone"].waitForExistence(timeout: 2))
    app.buttons["This iPhone"].tap()
    app.buttons["Continue"].tap()
    app.buttons["OpenCode"].tap()
    let key = app.secureTextFields["OpenCode API key"]
    XCTAssertTrue(key.waitForExistence(timeout: 2))
    key.tap()
    key.typeText("chief-qa-key")
    app.buttons["Continue"].tap()
    app.buttons["Enter workspace"].tap()

    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Chief could not'"))
        .firstMatch.waitForExistence(timeout: 5)
    )
    XCTAssertTrue(app.buttons["Enter workspace"].exists)
  }
}
