import Foundation

/// Reads the canonical filesystem-authored agent package shipped with the app.
/// The package remains the source of truth for identity and operating prompt;
/// Swift supplies only the host bindings that iOS can safely execute.
enum AgentPackageBundle {
  static func instructions(agentID: String) -> String? {
    guard safeName(agentID),
      let url = Bundle.main.url(
        forResource: "instructions",
        withExtension: "md",
        subdirectory: "agents/\(agentID)"
      ),
      let source = try? String(contentsOf: url, encoding: .utf8)
    else { return nil }
    return source.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func runtimeConfigURL(agentID: String) -> URL? {
    guard safeName(agentID) else { return nil }
    return Bundle.main.url(
      forResource: "agent",
      withExtension: "ts",
      subdirectory: "agents/\(agentID)"
    )
  }

  private static func safeName(_ value: String) -> Bool {
    value.range(
      of: #"^[a-z0-9]+(?:-[a-z0-9]+)*$"#,
      options: .regularExpression
    ) != nil
  }
}
