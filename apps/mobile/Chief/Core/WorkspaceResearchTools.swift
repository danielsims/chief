import Foundation

struct BrandProfileGetTool: RelayTool {
  static let name = "brand_profile_get"
  static let description = "Read the current shared workspace brand profile, if one has been saved."
  static let parameters: [RelayToolParameter] = []

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    guard let profile = try await context.relay.loadBrandProfile(
      workspaceID: context.workspaceID,
      signingIdentity: context.identity
    ) else { return toolResultJSON(["profile": NSNull()]) }
    return toolResultJSON([
      "markdown": profile.markdown,
      "sourceUrls": profile.sourceUrls,
      "version": profile.version,
      "updatedAt": profile.updatedAt,
    ])
  }
}

struct BrandProfileSaveTool: RelayTool {
  static let name = "brand_profile_save"
  static let description =
    "Save an evidence-backed Markdown brand profile as shared durable workspace context and as the visible versioned file brand/profile.md. Call only after inspecting the supplied first-party sources. This is the mobile equivalent of localTools.brandProfileSave."
  static let parameters = [
    RelayToolParameter(name: "markdown", kind: .string, description: "The complete Markdown brand profile."),
    RelayToolParameter(name: "sourceUrls", kind: .string, description: "A JSON array of exact HTTP or HTTPS source URLs inspected."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let sourceURLs = try parseURLArray(arguments["sourceUrls"], name: "sourceUrls")
    guard !sourceURLs.isEmpty else { throw ToolError.invalidArgument("sourceUrls") }
    let hasEvidence = await MainActor.run {
      sourceURLs.allSatisfy {
        AgentBrowserSession.hasSnapshotEvidence(for: context.browserScope, url: $0)
      }
    }
    guard hasEvidence else {
      throw ToolError.invalidArgument("sourceUrls must exactly match pages inspected with browser_snapshot this turn")
    }
    let file = try await context.relay.saveBrandProfile(
      workspaceID: context.workspaceID,
      markdown: arguments.requiredString("markdown"),
      sourceURLs: sourceURLs,
      conversationID: context.conversationID,
      signingIdentity: context.identity
    )
    return toolResultJSON([
      "saved": true,
      "fileId": file.id,
      "path": file.path,
      "version": file.version,
    ])
  }
}

struct WorkspaceFilesListTool: RelayTool {
  static let name = "workspace_files_list"
  static let description = "List visible versioned files created in this isolated workspace."
  static let parameters: [RelayToolParameter] = []

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let files = try await context.relay.listWorkspaceFiles(
      workspaceID: context.workspaceID,
      signingIdentity: context.identity
    )
    return toolResultJSON([
      "files": files.map {
        ["id": $0.id, "path": $0.path, "title": $0.title, "version": $0.version]
      }
    ])
  }
}

private func parseURLArray(_ value: Any?, name: String) throws -> [String] {
  let values: [String]
  if let value = value as? [String] {
    values = value
  } else if let value = value as? String,
    let data = value.data(using: .utf8),
    let decoded = try? JSONSerialization.jsonObject(with: data) as? [String]
  {
    values = decoded
  } else {
    throw ToolError.invalidArgument(name)
  }
  guard values.allSatisfy({ raw in
    guard let url = URL(string: raw), let scheme = url.scheme?.lowercased() else { return false }
    return scheme == "https" && BrowserURLPolicy.allows(url)
  }) else { throw ToolError.invalidArgument(name) }
  return values
}
