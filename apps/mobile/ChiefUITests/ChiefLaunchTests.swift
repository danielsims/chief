import XCTest

@MainActor
final class ChiefLaunchTests: XCTestCase {
  func testDemoWorkspaceOpensTheSameCoreSurfacesAsDesktop() {
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "--reset-session"]
    app.launch()

    XCTAssertTrue(app.buttons["Home"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["DMs"].exists)
    XCTAssertTrue(app.buttons["Projects"].exists)
    XCTAssertTrue(app.buttons["Agents"].exists)
    XCTAssertTrue(app.staticTexts["Channels"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.navigationBars["Overview"].exists)
    XCTAssertTrue(
      app.staticTexts["Good morning, Daniel"].exists
        || app.staticTexts["Good afternoon, Daniel"].exists
        || app.staticTexts["Good evening, Daniel"].exists)

    // Tapping a channel opens the conversation view with its messages.
    app.staticTexts["mission-control"].tap()
    XCTAssertTrue(
      app.staticTexts[
        "Morning Daniel. The team is moving. Engineering has the relay vertical slice ready for review."
      ].waitForExistence(timeout: 4))

    app.buttons["DMs"].tap()
    XCTAssertTrue(app.staticTexts["DMs"].waitForExistence(timeout: 3))

    app.buttons["Agents"].tap()
    XCTAssertTrue(app.staticTexts["Agents"].waitForExistence(timeout: 3))

    app.buttons["Projects"].tap()
    XCTAssertTrue(app.buttons["Home"].exists)
  }

  func testSignedOutExperienceUsesTheAgentTeamPromise() {
    let app = XCUIApplication()
    app.launchArguments = ["--reset-session"]
    app.launch()

    XCTAssertTrue(
      app.staticTexts["Your team of agents,\nalready at work."].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["sign-in-button"].exists)
  }

  func testWorkspaceAndProfileControlsAreFirstClass() {
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "--reset-session"]
    app.launch()

    XCTAssertTrue(app.buttons["Open profile"].waitForExistence(timeout: 5))
    app.buttons["workspace-switcher"].tap()
    XCTAssertTrue(app.navigationBars["Workspaces"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["Add workspace"].exists)
  }

  func testOnboardingStaysRecoverableWhenRelayIsUnavailable() {
    let app = XCUIApplication()
    app.launchArguments = ["--preview-onboarding"]
    app.launch()

    XCTAssertTrue(app.buttons["This iPhone"].waitForExistence(timeout: 5))
    app.buttons["This iPhone"].tap()
    app.buttons["Continue"].tap()
    app.buttons["OpenCode Go"].tap()
    let key = app.secureTextFields["OpenCode API key"]
    XCTAssertTrue(key.waitForExistence(timeout: 2))
    key.tap()
    key.typeText("chief-qa-key")
    app.buttons["Continue"].tap()
    let company = app.textFields["Company name"]
    XCTAssertTrue(company.waitForExistence(timeout: 2))
    company.tap()
    company.typeText("Chief Mobile QA")
    app.buttons["Continue"].tap()
    app.buttons["Enter workspace"].tap()

    XCTAssertTrue(
      app.staticTexts["Chief could not finish setting up this workspace. Try again."]
        .waitForExistence(timeout: 5)
    )
    XCTAssertTrue(app.buttons["Enter workspace"].exists)
  }
}
