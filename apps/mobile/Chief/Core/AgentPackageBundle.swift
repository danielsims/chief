import Foundation

struct AuthoredAgentPackage: Sendable {
  let id: String
  let instructions: String
  let runtimeConfigURL: URL
  let skillIDs: [String]
}

/// Reads the canonical filesystem-authored agent package shipped with the app.
/// The package remains the source of truth for identity and operating prompt;
/// Swift supplies only the host bindings that iOS can safely execute.
enum AgentPackageBundle {
  static func load(agentID: String) throws -> AuthoredAgentPackage {
    guard safeName(agentID) else { throw AgentPackageError.invalidID }
    guard let instructionsURL = Bundle.main.url(
      forResource: "instructions",
      withExtension: "md",
      subdirectory: "agents/\(agentID)"
    ), let runtimeConfigURL = runtimeConfigURL(agentID: agentID)
    else { throw AgentPackageError.missingRequiredFile(agentID) }
    let source = try String(contentsOf: instructionsURL, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !source.isEmpty else { throw AgentPackageError.emptyInstructions(agentID) }
    return AuthoredAgentPackage(
      id: agentID,
      instructions: source,
      runtimeConfigURL: runtimeConfigURL,
      skillIDs: skillIDs(agentID: agentID)
    )
  }

  static func instructions(agentID: String) -> String? {
    try? load(agentID: agentID).instructions
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

  private static func skillIDs(agentID: String) -> [String] {
    guard let root = Bundle.main.resourceURL?
      .appending(path: "agents/\(agentID)/skills", directoryHint: .isDirectory),
      let entries = try? FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles]
    ) else { return [] }
    return entries.compactMap { url in
      guard safeName(url.lastPathComponent),
        FileManager.default.fileExists(
          atPath: url.appending(path: "SKILL.md").path
        )
      else { return nil }
      return url.lastPathComponent
    }.sorted()
  }
}

enum AgentPackageError: LocalizedError {
  case invalidID
  case missingRequiredFile(String)
  case emptyInstructions(String)

  var errorDescription: String? {
    switch self {
    case .invalidID:
      "The agent package id is invalid."
    case .missingRequiredFile(let id):
      "The \(id) agent package is missing instructions.md or agent.ts."
    case .emptyInstructions(let id):
      "The \(id) agent package has empty instructions."
    }
  }
}
