import BrowserUI
import BrowserUIWebKit
import Foundation

private let browserActivityLabelParameter = RelayToolParameter(
  name: "activityLabel",
  kind: .string,
  description:
    "A specific two-to-five-word present-tense label shown to the user, at most 48 characters, such as Opening pricing page or Reviewing integrations. Never include secrets or typed values."
)

private func engagedBrowser(
  context: ToolContext,
  arguments: [String: Any]
) async throws -> WebKitBrowserDriver {
  let activityLabel = try arguments.requiredString("activityLabel")
  return await MainActor.run {
    AgentBrowserSession.engage(
      for: context.browserScope,
      operationLabel: activityLabel
    )
  }
}

struct BrowserNavigateTool: RelayTool {
  static let name = "browser_navigate"
  static let description =
    "Open a full public HTTPS URL in the isolated on-device WebKit browser. Local, private-network, credential-bearing, and insecure URLs are blocked. The user can watch the same page in Chief. Snapshot it after navigation before drawing conclusions."
  static let parameters = [
    RelayToolParameter(name: "url", kind: .string, description: "The complete public HTTPS URL to open."),
    browserActivityLabelParameter,
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let url = try arguments.requiredString("url")
    guard let parsedURL = URL(string: url), BrowserURLPolicy.allows(parsedURL) else {
      throw ToolError.invalidArgument("public HTTPS url")
    }
    let browser = try await engagedBrowser(context: context, arguments: arguments)
    return try await browser.navigate(url)
  }
}

struct BrowserSnapshotTool: RelayTool {
  static let name = "browser_snapshot"
  static let description =
    "Read the current page as a compact semantic snapshot containing the redacted URL, title, rendered text, and stable interactive element refs. Use this after every navigation or page action."
  static let parameters = [browserActivityLabelParameter]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let browser = try await engagedBrowser(context: context, arguments: arguments)
    let snapshot = try await browser.snapshot()
    await MainActor.run {
      AgentBrowserSession.recordSnapshot(
        for: context.browserScope,
        url: browser.url
      )
    }
    return snapshot
  }
}

struct BrowserClickTool: RelayTool {
  static let name = "browser_click"
  static let description =
    "Activate a link or button using a stable element ref from browser_snapshot. Snapshot again afterward."
  static let parameters = [
    RelayToolParameter(name: "target", kind: .string, description: "A stable element ref such as e4."),
    browserActivityLabelParameter,
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let browser = try await engagedBrowser(context: context, arguments: arguments)
    return try await browser.click(target: arguments.requiredString("target"))
  }
}

struct BrowserTypeTool: RelayTool {
  static let name = "browser_type"
  static let description =
    "Replace the value of an editable element using its stable snapshot ref. Optionally submit it with Enter, then snapshot the result."
  static let parameters = [
    RelayToolParameter(name: "target", kind: .string, description: "A stable editable element ref."),
    RelayToolParameter(name: "text", kind: .string, description: "The text to type."),
    RelayToolParameter(name: "submit", kind: .boolean, description: "Whether to submit with Enter.", required: false),
    browserActivityLabelParameter,
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let browser = try await engagedBrowser(context: context, arguments: arguments)
    let target = try arguments.requiredString("target")
    let typed = try await browser.type(target: target, text: arguments.requiredString("text"))
    guard arguments["submit"] as? Bool == true else { return typed }
    return typed + "\n" + (try await browser.press(key: "Enter", target: target))
  }
}

struct BrowserScrollTool: RelayTool {
  static let name = "browser_scroll"
  static let description =
    "Scroll the page up, down, left, or right by a bounded number of CSS pixels, then snapshot the newly visible content."
  static let parameters = [
    RelayToolParameter(name: "direction", kind: .string, description: "up, down, left, or right"),
    RelayToolParameter(name: "amount", kind: .integer, description: "Distance from 1 through 10000 CSS pixels."),
    browserActivityLabelParameter,
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    guard let direction = BrowserDriverScrollDirection(
      rawValue: try arguments.requiredString("direction").lowercased()
    ), let amount = arguments.optionalInt("amount"), (1...10_000).contains(amount)
    else { throw ToolError.invalidArgument("direction or amount") }
    let browser = try await engagedBrowser(context: context, arguments: arguments)
    return try await browser.scroll(direction: direction, amount: Double(amount))
  }
}

struct BrowserBackTool: RelayTool {
  static let name = "browser_back"
  static let description = "Go back one page in this agent conversation's isolated browser."
  static let parameters = [browserActivityLabelParameter]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let browser = try await engagedBrowser(context: context, arguments: arguments)
    return try await browser.goBack()
  }
}

struct BrowserReleaseTool: RelayTool {
  static let name = "browser_release"
  static let description =
    "Release agent control after verified browser work while preserving the page for the user. Use completed for finished research or waiting when the user must interact. This is terminal for the browser portion of the turn."
  static let parameters = [
    RelayToolParameter(name: "outcome", kind: .string, description: "completed or waiting"),
    RelayToolParameter(name: "label", kind: .string, description: "A short user-facing summary or handoff.", required: false),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    guard let outcome = BrowserSessionReleaseOutcome(
      rawValue: try arguments.requiredString("outcome").lowercased()
    ) else { throw ToolError.invalidArgument("outcome") }
    let label = arguments.optionalString("label")
    return try await MainActor.run {
      guard let browser = AgentBrowserSession.existingDriver(for: context.browserScope),
        browser.scope == context.browserScope
      else { throw ToolError.noActiveBrowser }
      let request = try browser.makeReleaseRequest(
        outcome: outcome,
        label: label
      )
      browser.releaseAgentControl()
      return String(decoding: try JSONEncoder().encode(request), as: UTF8.self)
    }
  }
}
