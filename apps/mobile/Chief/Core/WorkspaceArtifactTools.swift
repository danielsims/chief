import Foundation

struct WorkspaceFileWriteTool: RelayTool {
  static let name = "workspace_file_write"
  static let description = "Create or revise a durable artifact in a channel. Use markdown for documents, html for self-contained interactive tools, csv for tables, or json for structured data. For revisions supply id and expectedVersion. Afterwards post its ID with relay_message_post artifactIds to present a Canvas card. HTML must use inline CSS and JavaScript, no external dependencies or network calls."
  static let parameters: [RelayToolParameter] = [
    .init(name: "title", kind: .string, description: "A short name for the artifact."),
    .init(name: "content", kind: .string, description: "The complete artifact content, up to 200,000 characters."),
    .init(name: "format", kind: .string, description: "markdown, html, csv, or json.", required: false),
    .init(name: "conversationId", kind: .string, description: "The channel to create it in; defaults to this conversation.", required: false),
    .init(name: "id", kind: .string, description: "Existing file ID when revising.", required: false),
    .init(name: "expectedVersion", kind: .string, description: "The version read before making changes.", required: false),
  ]
  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let format = arguments.optionalString("format") ?? "markdown"
    let types = ["markdown": "text/markdown", "html": "text/html", "csv": "text/csv", "json": "application/json"]
    guard let mimeType = types[format] else { throw ToolError.invalidArgument("format") }
    let id = arguments.optionalString("id")
    let existing = if let id { try await context.relay.listWorkspaceFiles(workspaceID: context.workspaceID, signingIdentity: context.identity).first { $0.id == id } } else { Optional<WorkspaceFileRecord>.none }
    let version = arguments.optionalString("expectedVersion").flatMap(Int.init)
    if id != nil && (existing == nil || version == nil) { throw ToolError.invalidArgument("Read the existing artifact and pass its version before revising it") }
    let file = try await context.relay.saveWorkspaceFile(workspaceID: context.workspaceID, input: .init(
      id: id, path: existing?.path ?? "artifacts/\(UUID().uuidString).\(format == "markdown" ? "md" : format)",
      title: arguments.requiredString("title"), mimeType: mimeType, content: arguments.requiredString("content"),
      conversationId: arguments.optionalString("conversationId") ?? existing?.conversationId ?? context.conversationID, expectedVersion: version
    ), signingIdentity: context.identity)
    return toolResultJSON(["fileId": file.id, "title": file.title, "version": file.version, "conversationId": file.conversationId])
  }
}
