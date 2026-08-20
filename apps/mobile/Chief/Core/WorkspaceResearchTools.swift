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

struct ProspectsListTool: RelayTool {
  static let name = "prospects_list"
  static let description = "List the workspace's existing durable prospects before researching or saving duplicates."
  static let parameters: [RelayToolParameter] = []

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let prospects = try await context.relay.listProspects(
      workspaceID: context.workspaceID,
      signingIdentity: context.identity
    )
    return toolResultJSON([
      "prospects": prospects.map {
        ["id": $0.id, "name": $0.name, "sourceUrl": $0.sourceUrl, "relevance": $0.relevance]
      }
    ])
  }
}

struct ProspectSaveTool: RelayTool {
  static let name = "prospects_save"
  static let description =
    "Save one genuinely qualified prospect or public buying signal with a direct source URL, specific evidence, relevance, and useful outreach angle. This is the mobile equivalent of localTools.prospectsSave."
  static let parameters = [
    RelayToolParameter(name: "id", kind: .string, description: "A stable lowercase identifier."),
    RelayToolParameter(name: "name", kind: .string, description: "The person, company, or public conversation name."),
    RelayToolParameter(name: "company", kind: .string, description: "Company name when applicable.", required: false),
    RelayToolParameter(name: "source", kind: .string, description: "The source name, such as Company website or Reddit."),
    RelayToolParameter(name: "sourceUrl", kind: .string, description: "The exact direct HTTP or HTTPS evidence URL."),
    RelayToolParameter(name: "summary", kind: .string, description: "Why this finding matters now."),
    RelayToolParameter(name: "evidence", kind: .string, description: "Specific observed evidence from the source."),
    RelayToolParameter(name: "outreachAngle", kind: .string, description: "A useful, value-first response or outreach angle."),
    RelayToolParameter(name: "relevance", kind: .string, description: "high, medium, or low"),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let relevance = try arguments.requiredString("relevance").lowercased()
    guard ["high", "medium", "low"].contains(relevance) else {
      throw ToolError.invalidArgument("relevance")
    }
    let sourceURL = try arguments.requiredString("sourceUrl")
    guard let url = URL(string: sourceURL), BrowserURLPolicy.allows(url) else {
      throw ToolError.invalidArgument("sourceUrl")
    }
    let hasEvidence = await MainActor.run {
      AgentBrowserSession.hasSnapshotEvidence(for: context.browserScope, url: sourceURL)
    }
    guard hasEvidence else {
      throw ToolError.invalidArgument("sourceUrl must exactly match a page inspected with browser_snapshot this turn")
    }
    let prospect = try await context.relay.saveProspect(
      workspaceID: context.workspaceID,
      prospect: ProspectSaveInput(
        id: try arguments.requiredString("id"),
        name: try arguments.requiredString("name"),
        company: arguments.optionalString("company"),
        source: try arguments.requiredString("source"),
        sourceUrl: sourceURL,
        summary: try arguments.requiredString("summary"),
        evidence: try arguments.requiredString("evidence"),
        outreachAngle: try arguments.requiredString("outreachAngle"),
        relevance: relevance,
        status: "new"
      ),
      signingIdentity: context.identity
    )
    return toolResultJSON(["saved": true, "prospectId": prospect.id])
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
