import Foundation

/// A native tool the on-device agent can call during a turn. Tools mirror the
/// ios-durable-agent `LiteRTLM.Tool` pattern: they are defined alongside the
/// agent, run in Swift, and stream their invocation records back in the
/// response envelope so the worker persists them into the durable transcript.
protocol RelayTool: Sendable {
  static var name: String { get }
  static var description: String { get }
  /// The tool's argument schema (a JSON-schema subset) advertised to the model.
  static var parameters: [RelayToolParameter] { get }
  /// Construct a fresh, stateless instance per call.
  init()
  func run(arguments: [String: Any], context: ToolContext) async throws -> String
}

struct RelayToolParameter: Sendable {
  enum Kind: String, Sendable {
    case string
    case integer
    case boolean
    case stringArray
  }

  let name: String
  let kind: Kind
  let description: String
  let required: Bool

  init(name: String, kind: Kind, description: String, required: Bool = true) {
    self.name = name
    self.kind = kind
    self.description = description
    self.required = required
  }
}

/// Everything a tool needs to act in the workspace on the agent's own identity.
struct ToolContext: Sendable {
  let relay: any RelayServing
  let identity: NostrIdentity
  let agentID: String
  let workspaceID: String
  let conversationID: String
  let config: AgentConfig
  let allowedToolNames: Set<String>
}

/// The JSON-schema `parameters` object for an OpenAI function tool.
func toolSchema(_ parameters: [RelayToolParameter]) -> [String: Any] {
  var properties: [String: Any] = [:]
  var required: [String] = []
  for parameter in parameters {
    properties[parameter.name] =
      parameter.kind == .stringArray
      ? [
        "type": "array",
        "items": ["type": "string"],
        "description": parameter.description,
      ]
      : [
        "type": parameter.kind.rawValue,
        "description": parameter.description,
      ]
    if parameter.required { required.append(parameter.name) }
  }
  var schema: [String: Any] = ["type": "object", "properties": properties]
  if !required.isEmpty { schema["required"] = required }
  return schema
}

/// Registry of the tools the agent advertises to the model and can execute
/// natively. Tools are package-level (workspace relay capabilities), matching
/// the PRD toolset: channels, messages, thread replies, reactions.
enum RelayToolRegistry {
  static let tools: [any RelayTool.Type] = [
    RelayChannelsListTool.self,
    RelayWorkspaceMembersTool.self,
    RelayChannelCreateTool.self,
    RelayChannelMembersAddTool.self,
    RelayMessagesListTool.self,
    RelayMessagePostTool.self,
    RelayThreadRepliesTool.self,
    RelayMessageSearchTool.self,
    RelayReactionAddTool.self,
    RelayReactionRemoveTool.self,
    BrowserNavigateTool.self,
    BrowserSnapshotTool.self,
    BrowserClickTool.self,
    BrowserTypeTool.self,
    BrowserScrollTool.self,
    BrowserBackTool.self,
    BrowserReleaseTool.self,
    BrandProfileGetTool.self,
    BrandProfileSaveTool.self,
    ProspectsListTool.self,
    ProspectSaveTool.self,
    WorkspaceFilesListTool.self,
  ]

  /// OpenAI-compatible `tools` definitions for the inference request.
  static func openAIDefinitions(
    allowing allowedToolNames: Set<String>
  ) -> [OpenCodeRequest.ToolDefinition] {
    tools.filter { allowedToolNames.contains($0.name) }.map { tool in
      let parameters = toolSchema(tool.parameters).mapValues {
        AnyEncodable(value: $0)
      }
      return OpenCodeRequest.ToolDefinition(
        type: "function",
        function: .init(
          name: tool.name,
          description: tool.description,
          parameters: parameters
        )
      )
    }
  }

  /// Execute a model-requested tool call, returning the tool's JSON output.
  static func execute(
    name: String,
    arguments: String,
    context: ToolContext
  ) async throws -> String {
    guard context.allowedToolNames.contains(name) else {
      throw ToolError.permissionDenied("turn-scoped \(name)")
    }
    guard let tool = tools.first(where: { $0.name == name }) else {
      throw ToolError.unknown(name)
    }
    let area = permissionArea(for: name)
    guard context.config.permitsToolArea(area) else {
      throw ToolError.permissionDenied(area)
    }
    let parsed =
      (try? JSONSerialization.jsonObject(with: Data(arguments.utf8)) as? [String: Any])
      ?? [:]
    return try await tool.init().run(arguments: parsed, context: context)
  }

  private static func permissionArea(for tool: String) -> String {
    if tool == RelayWorkspaceMembersTool.name { return "workspace" }
    if tool.hasPrefix("relay_channels_") { return "channels" }
    if tool.hasPrefix("browser_") { return "advanced" }
    if tool == BrandProfileSaveTool.name { return "brand-profile-write" }
    if tool == ProspectSaveTool.name { return "prospects-write" }
    if tool == BrandProfileGetTool.name
      || tool == ProspectsListTool.name
      || tool == WorkspaceFilesListTool.name
    {
      return "workspace"
    }
    return "messages"
  }
}

enum ToolError: LocalizedError {
  case unknown(String)
  case missingArgument(String)
  case permissionDenied(String)
  case invalidArgument(String)
  case noActiveBrowser

  var errorDescription: String? {
    switch self {
    case .unknown(let name): "Unknown tool: \(name)."
    case .missingArgument(let name): "Missing required argument: \(name)."
    case .permissionDenied(let area):
      "Workspace policy does not grant this agent the \(area) permission."
    case .invalidArgument(let name): "Invalid argument: \(name)."
    case .noActiveBrowser: "No active browser belongs to this agent conversation."
    }
  }
}

extension Dictionary where Key == String, Value == Any {
  /// A required string argument, validated so the model's JSON surfaces a
  /// clear error instead of failing the whole turn.
  func requiredString(_ name: String) throws -> String {
    guard let value = self[name] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw ToolError.missingArgument(name)
    }
    return value
  }

  func optionalString(_ name: String) -> String? {
    guard let value = self[name] as? String else { return nil }
    return value.isEmpty ? nil : value
  }

  func optionalInt(_ name: String) -> Int? {
    if let value = self[name] as? Int { return value }
    if let value = self[name] as? Double, value.rounded() == value {
      return Int(value)
    }
    return nil
  }
}

/// Serialize a tool result as JSON text for the model's `tool` message.
func toolResultJSON(_ object: [String: Any]) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: object) else {
    return #"{"error":"result could not be serialized"}"#
  }
  return String(data: data, encoding: .utf8)
    ?? #"{"error":"result could not be serialized"}"#
}
