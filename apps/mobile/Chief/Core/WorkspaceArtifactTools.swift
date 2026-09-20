import Foundation

struct WorkspaceFileWriteTool: RelayTool {
  static let name = "files_write"
  static let aliases = ["workspace_file_write"]
  static let description = "Create or revise a durable artifact in a channel. Use markdown for documents, html for self-contained interactive tools, csv for tables, or json for structured data. For revisions supply id and expectedVersionId. Afterwards post its ID with channels.messages.post artifactIds to present a Canvas card. HTML must use inline CSS and JavaScript, no external dependencies or network calls."
  static let parameters: [RelayToolParameter] = [
    .init(name: "name", kind: .string, description: "A short name for the artifact.", required: false),
    .init(name: "title", kind: .string, description: "Alias of name.", required: false),
    .init(
      name: "content",
      kind: .string,
      description: "The complete artifact content, up to 200,000 characters.",
      maxUTF8Count: 200_000
    ),
    .init(name: "format", kind: .string, description: "markdown, html, csv, or json.", required: false),
    .init(name: "conversationId", kind: .string, description: "The channel to create it in; defaults to this conversation.", required: false),
    .init(name: "id", kind: .string, description: "Existing file ID when revising.", required: false),
    .init(name: "path", kind: .string, description: "Optional workspace path for the artifact.", required: false),
    .init(name: "expectedVersionId", kind: .string, description: "The version read before making changes.", required: false),
    .init(name: "expectedVersion", kind: .string, description: "Alias of expectedVersionId.", required: false),
    .init(name: "kind", kind: .string, description: "document or email.", required: false),
  ]
  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let title = arguments.optionalString("name") ?? arguments.optionalString("title")
    guard let title else { throw ToolError.missingArgument("name") }
    let format = arguments.optionalString("format") ?? "markdown"
    let types = ["markdown": "text/markdown", "html": "text/html", "csv": "text/csv", "json": "application/json"]
    let mimeType = arguments.optionalString("kind") == "email"
      ? "message/rfc822"
      : types[format]
    guard let mimeType else { throw ToolError.invalidArgument("format") }
    let id = arguments.optionalString("id")
    let existing = if let id { try await context.relay.listWorkspaceFiles(workspaceID: context.workspaceID, signingIdentity: context.identity).first { $0.id == id } } else { Optional<WorkspaceFileRecord>.none }
    let version = (arguments.optionalString("expectedVersionId") ?? arguments.optionalString("expectedVersion")).flatMap(Int.init)
      ?? existing.map(\.version)
    if id != nil && existing == nil { throw ToolError.invalidArgument("Read the existing artifact and pass its version before revising it") }
    let file = try await context.relay.saveWorkspaceFile(workspaceID: context.workspaceID, input: .init(
      id: id, path: arguments.optionalString("path") ?? existing?.path ?? "artifacts/\(UUID().uuidString).\(format == "markdown" ? "md" : format)",
      title: title, mimeType: mimeType, content: arguments.requiredString("content"),
      conversationId: arguments.optionalString("conversationId") ?? existing?.conversationId ?? context.conversationID, expectedVersion: version
    ), signingIdentity: context.identity)
    return toolResultJSON(["fileId": file.id, "title": file.title, "version": file.version, "conversationId": file.conversationId])
  }
}
